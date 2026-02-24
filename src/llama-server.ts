import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getSystemSpecs } from "./hardware";
import type { AppConfig } from "./types";

const HEALTH_PATH = "/health";
const STARTUP_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_INTERVAL_MS = 500;
const STDERR_TAIL_LIMIT = 120;

type StartFailureKind =
  | "binary-not-found"
  | "model-not-found"
  | "port-unavailable"
  | "health-timeout"
  | "process-exited"
  | "start-failed";

interface PortOwnerInfo {
  pid: number;
  uid: number | null;
  command: string;
}

interface LlamaRuntimeDeps {
  checkHealth: (baseUrl: string) => Promise<boolean>;
  inspectPortOwner: (host: string, port: number) => Promise<PortOwnerInfo | null>;
  sleep: (ms: number) => Promise<void>;
  spawnProcess: typeof spawn;
  sendSignal: (pid: number, signal: NodeJS.Signals) => void;
  isPidRunning: (pid: number) => boolean;
  currentUid: () => number | null;
}

export interface LlamaServerFailure {
  kind: StartFailureKind;
  message: string;
  details: string[];
  host?: string;
  port?: number;
  conflictPid?: number;
  conflictCommand?: string;
}

export interface EnsureLlamaReadyResult {
  ready: boolean;
  started: boolean;
  failure?: LlamaServerFailure;
}

export interface StartLlamaServerResult {
  started: boolean;
  failure?: LlamaServerFailure;
}

interface StartContext {
  binaryPath: string;
  modelPath: string;
  baseUrl: string;
  host: string;
  port: number;
}

interface RunningServerState {
  process: ChildProcess;
  baseUrl: string;
  modelPath: string;
}

let runningState: RunningServerState | null = null;

const LOCAL_ENDPOINT_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1"
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveHost(config: AppConfig): string {
  const host = config.llamaHost.trim();
  return host.length > 0 ? host : "127.0.0.1";
}

function resolvePort(config: AppConfig): number {
  return Number.isInteger(config.llamaPort) && config.llamaPort > 0 ? config.llamaPort : 8080;
}

function buildBaseUrl(config: AppConfig): string {
  const host = resolveHost(config);
  const port = resolvePort(config);
  const fallback = `http://${host}:${port}`;
  const trimmed = config.llamaBaseUrl?.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : fallback;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return LOCAL_ENDPOINT_HOSTS.has(normalized) || normalized.startsWith("127.");
}

export function isLocalLlamaEndpoint(config: AppConfig): boolean {
  const baseUrl = buildBaseUrl(config);
  try {
    const parsed = new URL(baseUrl);
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function buildDefaultDeps(overrides?: Partial<LlamaRuntimeDeps>): LlamaRuntimeDeps {
  return {
    checkHealth: checkLlamaHealth,
    inspectPortOwner: inspectPortOwner,
    sleep,
    spawnProcess: spawn,
    sendSignal: (pid, signal) => {
      process.kill(pid, signal);
    },
    isPidRunning: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    currentUid: () => {
      return typeof process.getuid === "function" ? process.getuid() : null;
    },
    ...overrides
  };
}

async function resolveServerBinaryPath(config: AppConfig): Promise<string | null> {
  const envPath = process.env["LLAMA_SERVER_PATH"]?.trim();
  if (envPath && (await exists(envPath))) {
    return envPath;
  }

  const configPath = config.llamaServerPath.trim();
  if (configPath && (await exists(configPath))) {
    return configPath;
  }

  const whichResult = spawnSync("which", ["llama-server"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (whichResult.status === 0) {
    const whichPath = String(whichResult.stdout ?? "").trim();
    if (whichPath.length > 0 && (await exists(whichPath))) {
      return whichPath;
    }
  }

  const fallback = resolve(process.env["HOME"] ?? "~", "llama.cpp", "build", "bin", "llama-server");
  if (await exists(fallback)) {
    return fallback;
  }

  return null;
}

async function collectGgufPaths(root: string): Promise<string[]> {
  const discovered: string[] = [];

  async function walk(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
        discovered.push(fullPath);
      }
    }
  }

  try {
    await walk(root);
  } catch {
    return [];
  }

  return discovered;
}

async function resolveModelPath(config: AppConfig): Promise<string | null> {
  const model = config.model.trim();
  if (model.length === 0 || model.toLowerCase() === "default") {
    return null;
  }

  if (await exists(model)) {
    return resolve(model);
  }

  const fromModelsDir = resolve(config.llamaModelsDir, model);
  if (await exists(fromModelsDir)) {
    return fromModelsDir;
  }

  const candidates = await collectGgufPaths(resolve(config.llamaModelsDir));
  const found = candidates.find((candidate) => candidate.includes(model));
  return found ?? null;
}

function getOptimalContextSize(): number {
  const specs = getSystemSpecs();
  const rawContext = Math.floor(specs.totalMemoryGb * 512);
  const rounded = Math.floor(rawContext / 1024) * 1024;
  return Math.max(2048, rounded);
}

function startFailure(
  kind: StartFailureKind,
  message: string,
  details: string[],
  metadata?: Partial<LlamaServerFailure>
): StartLlamaServerResult {
  return {
    started: false,
    failure: {
      kind,
      message,
      details,
      ...metadata
    }
  };
}

function parseProcNetListeners(procNetText: string, port: number): string[] {
  const inodes: string[] = [];
  for (const line of procNetText.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) {
      continue;
    }
    const localAddress = parts[1] ?? "";
    const state = parts[3] ?? "";
    const inode = parts[9] ?? "";
    if (state !== "0A" || inode.length === 0) {
      continue;
    }

    const addressParts = localAddress.split(":");
    if (addressParts.length !== 2) {
      continue;
    }
    const portHex = addressParts[1] ?? "";
    const entryPort = Number.parseInt(portHex, 16);
    if (entryPort === port) {
      inodes.push(inode);
    }
  }
  return inodes;
}

async function readProcessUid(pid: number): Promise<number | null> {
  try {
    const statusText = await readFile(`/proc/${pid}/status`, "utf8");
    const uidLine = statusText
      .split(/\r?\n/)
      .find((line) => line.startsWith("Uid:") || line.startsWith("Uid\t"));
    if (!uidLine) {
      return null;
    }
    const fields = uidLine.trim().split(/\s+/);
    const uid = Number.parseInt(fields[1] ?? "", 10);
    return Number.isInteger(uid) ? uid : null;
  } catch {
    return null;
  }
}

async function readProcessCommand(pid: number): Promise<string> {
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
    const text = cmdline.replace(/\0+/g, " ").trim();
    if (text.length > 0) {
      return text;
    }
  } catch {
    // noop
  }

  try {
    return (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
  } catch {
    return "unknown";
  }
}

async function findPortOwnerByInode(inode: string): Promise<PortOwnerInfo | null> {
  let processEntries;
  try {
    processEntries = await readdir("/proc", { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of processEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }

    const pid = Number.parseInt(entry.name, 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }

    let fdEntries;
    try {
      fdEntries = await readdir(`/proc/${pid}/fd`, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fdEntry of fdEntries) {
      const fdPath = `/proc/${pid}/fd/${fdEntry.name}`;
      let target: string;
      try {
        target = await readlink(fdPath);
      } catch {
        continue;
      }
      if (target === `socket:[${inode}]`) {
        return {
          pid,
          uid: await readProcessUid(pid),
          command: await readProcessCommand(pid)
        };
      }
    }
  }

  return null;
}

async function inspectPortOwner(_host: string, port: number): Promise<PortOwnerInfo | null> {
  if (process.platform !== "linux") {
    return null;
  }

  const inodeSet = new Set<string>();
  for (const path of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = await readFile(path, "utf8");
      for (const inode of parseProcNetListeners(content, port)) {
        inodeSet.add(inode);
      }
    } catch {
      // noop
    }
  }

  for (const inode of inodeSet) {
    const owner = await findPortOwnerByInode(inode);
    if (owner) {
      return owner;
    }
  }

  return null;
}

function isLlamaServerCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.includes("llama-server") || normalized.includes("llama.cpp/build/bin/server");
}

async function tryTerminatePid(pid: number, deps: LlamaRuntimeDeps): Promise<boolean> {
  try {
    deps.sendSignal(pid, "SIGTERM");
  } catch {
    return !deps.isPidRunning(pid);
  }

  for (let i = 0; i < 6; i += 1) {
    if (!deps.isPidRunning(pid)) {
      return true;
    }
    await deps.sleep(500);
  }

  try {
    deps.sendSignal(pid, "SIGKILL");
  } catch {
    return !deps.isPidRunning(pid);
  }

  for (let i = 0; i < 4; i += 1) {
    if (!deps.isPidRunning(pid)) {
      return true;
    }
    await deps.sleep(250);
  }

  return !deps.isPidRunning(pid);
}

async function resolvePortConflict(
  config: AppConfig,
  context: StartContext,
  deps: LlamaRuntimeDeps
): Promise<StartLlamaServerResult | null> {
  const owner = await deps.inspectPortOwner(context.host, context.port);
  if (!owner) {
    return null;
  }

  const ownerText = `PID ${owner.pid} (${owner.command})`;
  const metadata = {
    host: context.host,
    port: context.port,
    conflictPid: owner.pid,
    conflictCommand: owner.command
  };

  const policy = config.llamaPortConflictPolicy;
  if (policy === "fail") {
    return startFailure(
      "port-unavailable",
      `Configured llama.cpp port ${context.host}:${context.port} is already in use by ${ownerText}.`,
      ["Change llamaPort or stop the conflicting process."],
      metadata
    );
  }

  if (policy === "kill-llama" && !isLlamaServerCommand(owner.command)) {
    return startFailure(
      "port-unavailable",
      `Configured llama.cpp port ${context.host}:${context.port} is already in use by ${ownerText}.`,
      ["Port conflict policy is kill-llama, but the owner is not llama-server."],
      metadata
    );
  }

  if (policy === "kill-user") {
    const currentUid = deps.currentUid();
    if (currentUid === null || owner.uid === null || owner.uid !== currentUid) {
      return startFailure(
        "port-unavailable",
        `Configured llama.cpp port ${context.host}:${context.port} is already in use by ${ownerText}.`,
        ["Port conflict policy is kill-user, but the process is not owned by current user."],
        metadata
      );
    }
  }

  const terminated = await tryTerminatePid(owner.pid, deps);
  if (!terminated) {
    return startFailure(
      "port-unavailable",
      `Failed to free llama.cpp port ${context.host}:${context.port} from ${ownerText}.`,
      ["Tried SIGTERM then SIGKILL."],
      metadata
    );
  }

  const remainingOwner = await deps.inspectPortOwner(context.host, context.port);
  if (remainingOwner) {
    return startFailure(
      "port-unavailable",
      `Configured llama.cpp port ${context.host}:${context.port} is still in use after terminating ${ownerText}.`,
      [
        `Current owner: PID ${remainingOwner.pid} (${remainingOwner.command})`,
        "Change llamaPort or stop the conflicting process manually."
      ],
      {
        host: context.host,
        port: context.port,
        conflictPid: remainingOwner.pid,
        conflictCommand: remainingOwner.command
      }
    );
  }

  return null;
}

function pushStderrLines(buffer: string[], chunk: string, partial: { value: string }): void {
  partial.value += chunk;
  const lines = partial.value.split(/\r?\n/);
  partial.value = lines.pop() ?? "";
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    buffer.push(line);
    if (buffer.length > STDERR_TAIL_LIMIT) {
      buffer.shift();
    }
  }
}

function flushStderrPartial(buffer: string[], partial: { value: string }): void {
  const tail = partial.value.trim();
  if (tail.length > 0) {
    buffer.push(tail);
    if (buffer.length > STDERR_TAIL_LIMIT) {
      buffer.shift();
    }
  }
  partial.value = "";
}

function isBindError(stderrLines: readonly string[]): boolean {
  const text = stderrLines.join("\n").toLowerCase();
  return (
    text.includes("couldn't bind") ||
    text.includes("address already in use") ||
    text.includes("http server socket") ||
    text.includes("exiting due to http server error")
  );
}

function stderrTailDetails(stderrLines: readonly string[]): string[] {
  if (stderrLines.length === 0) {
    return [];
  }
  const tail = stderrLines.slice(-6);
  return ["llama-server stderr (tail):", ...tail.map((line) => `  ${line}`)];
}

export async function checkLlamaHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const endpoint = `${baseUrl.replace(/\/+$/, "")}${HEALTH_PATH}`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function killProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  process.kill("SIGTERM");
  const started = Date.now();
  while (process.exitCode === null && Date.now() - started < 5_000) {
    await sleep(100);
  }
  if (process.exitCode === null) {
    process.kill("SIGKILL");
  }
}

export async function stopLlamaServer(): Promise<void> {
  if (!runningState) {
    return;
  }
  const state = runningState;
  runningState = null;
  await killProcess(state.process);
}

export async function resetLlamaForFreshSession(
  config: AppConfig,
  overrides?: Partial<LlamaRuntimeDeps>
): Promise<StartLlamaServerResult> {
  if (!isLocalLlamaEndpoint(config)) {
    return { started: false };
  }

  await stopLlamaServer();
  return startLlamaServer(config, overrides);
}

async function createStartContext(config: AppConfig): Promise<StartContext | StartLlamaServerResult> {
  const binaryPath = await resolveServerBinaryPath(config);
  const baseUrl = buildBaseUrl(config);
  const modelPath = await resolveModelPath(config);
  const host = resolveHost(config);
  const port = resolvePort(config);

  if (!binaryPath) {
    return startFailure("binary-not-found", "Could not locate llama-server binary.", [
      "Set LLAMA_SERVER_PATH or config.llamaServerPath to your llama-server executable.",
      "Try: which llama-server"
    ]);
  }

  if (!modelPath) {
    return startFailure("model-not-found", `Could not resolve configured model '${config.model}'.`, [
      `Checked models dir: ${config.llamaModelsDir}`,
      "Pick a model with /model or update config.model."
    ]);
  }

  return {
    binaryPath,
    modelPath,
    baseUrl,
    host,
    port
  };
}

export async function startLlamaServer(
  config: AppConfig,
  overrides?: Partial<LlamaRuntimeDeps>
): Promise<StartLlamaServerResult> {
  const deps = buildDefaultDeps(overrides);
  const contextOrFailure = await createStartContext(config);
  if ("started" in contextOrFailure) {
    return contextOrFailure;
  }
  const context = contextOrFailure;

  if (runningState && runningState.baseUrl === context.baseUrl) {
    if (await deps.checkHealth(context.baseUrl)) {
      return { started: false };
    }
    await stopLlamaServer();
  }

  const preStartConflict = await resolvePortConflict(config, context, deps);
  if (preStartConflict) {
    return preStartConflict;
  }

  const contextSize = config.llamaContextSize > 0 ? config.llamaContextSize : getOptimalContextSize();
  const gpuLayers = config.llamaGpuLayers > 0 ? config.llamaGpuLayers : 999;
  const args = [
    "-m",
    context.modelPath,
    "-c",
    String(contextSize),
    "--host",
    context.host,
    "--port",
    String(context.port),
    "--embedding",
    "-ngl",
    String(gpuLayers)
  ];

  let process: ChildProcess;
  const stderrLines: string[] = [];
  const partial = { value: "" };
  try {
    process = deps.spawnProcess(context.binaryPath, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    process.stderr?.setEncoding("utf8");
    process.stderr?.on("data", (chunk: string | Buffer) => {
      pushStderrLines(stderrLines, String(chunk), partial);
    });
  } catch (error) {
    return startFailure("start-failed", `Failed to start llama-server: ${toErrorMessage(error)}`, [
      `Binary: ${context.binaryPath}`,
      `Model: ${context.modelPath}`
    ]);
  }

  runningState = {
    process,
    baseUrl: context.baseUrl,
    modelPath: context.modelPath
  };

  const started = Date.now();
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
    if (process.exitCode !== null) {
      runningState = null;
      flushStderrPartial(stderrLines, partial);
      const bindFailure = isBindError(stderrLines);
      const details = [
        `Binary: ${context.binaryPath}`,
        `Model: ${context.modelPath}`,
        `Endpoint: ${context.host}:${context.port}`,
        ...stderrTailDetails(stderrLines)
      ];
      if (bindFailure || process.exitCode === 98) {
        return startFailure(
          "port-unavailable",
          `llama-server could not bind ${context.host}:${context.port}.`,
          details,
          { host: context.host, port: context.port }
        );
      }

      return startFailure(
        "process-exited",
        `llama-server exited before becoming healthy (exit code ${String(process.exitCode)}).`,
        details,
        { host: context.host, port: context.port }
      );
    }
    if (await deps.checkHealth(context.baseUrl)) {
      return { started: true };
    }
    await deps.sleep(HEALTH_RETRY_INTERVAL_MS);
  }

  await stopLlamaServer();
  return startFailure("health-timeout", "llama-server did not report healthy status before timeout.", [
    `Endpoint: ${context.baseUrl}${HEALTH_PATH}`,
    `Model: ${context.modelPath}`
  ]);
}

function failureFromResult(result: StartLlamaServerResult): LlamaServerFailure {
  return (
    result.failure ?? {
      kind: "start-failed",
      message: "Failed to start llama-server.",
      details: []
    }
  );
}

export async function ensureLlamaReady(
  config: AppConfig,
  overrides?: Partial<LlamaRuntimeDeps>
): Promise<EnsureLlamaReadyResult> {
  const deps = buildDefaultDeps(overrides);
  const baseUrl = buildBaseUrl(config);
  if (await deps.checkHealth(baseUrl)) {
    return { ready: true, started: false };
  }

  if (!config.llamaAutoStart) {
    return {
      ready: false,
      started: false,
      failure: {
        kind: "start-failed",
        message: "llama.cpp is not reachable and auto-start is disabled.",
        details: [`Expected endpoint: ${baseUrl}${HEALTH_PATH}`]
      }
    };
  }

  const started = await startLlamaServer(config, overrides);
  if (started.failure) {
    return {
      ready: false,
      started: false,
      failure: failureFromResult(started)
    };
  }

  return { ready: true, started: started.started };
}

export function formatLlamaStartupFailure(failure: LlamaServerFailure, config: AppConfig): string {
  const lines = [`${failure.message}`];
  if (failure.host && failure.port) {
    lines.push(`- Endpoint: ${failure.host}:${failure.port}`);
  }
  if (failure.conflictPid && failure.conflictCommand) {
    lines.push(`- Conflict: PID ${failure.conflictPid} (${failure.conflictCommand})`);
  }
  for (const detail of failure.details) {
    lines.push(`- ${detail}`);
  }
  lines.push(`- Base URL: ${buildBaseUrl(config)}`);
  lines.push("- Verify llama-server is installed: which llama-server");
  lines.push(`- Verify model exists: ls ${resolve(config.llamaModelsDir, config.model)}`);
  return lines.join("\n");
}
