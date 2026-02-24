import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getSystemSpecs } from "./hardware";
import type { AppConfig } from "./types";

const HEALTH_PATH = "/health";
const STARTUP_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_INTERVAL_MS = 500;

type StartFailureKind =
  | "binary-not-found"
  | "model-not-found"
  | "port-unavailable"
  | "health-timeout"
  | "process-exited"
  | "start-failed";

export interface LlamaServerFailure {
  kind: StartFailureKind;
  message: string;
  details: string[];
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
}

interface RunningServerState {
  process: ChildProcess;
  baseUrl: string;
  modelPath: string;
}

let runningState: RunningServerState | null = null;

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

function buildBaseUrl(config: AppConfig): string {
  const host = config.llamaHost.trim() || "127.0.0.1";
  const port = Number.isInteger(config.llamaPort) && config.llamaPort > 0 ? config.llamaPort : 8080;
  const fallback = `http://${host}:${port}`;
  const trimmed = config.llamaBaseUrl?.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : fallback;
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

function startFailure(kind: StartFailureKind, message: string, details: string[]): StartLlamaServerResult {
  return {
    started: false,
    failure: {
      kind,
      message,
      details
    }
  };
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

async function createStartContext(config: AppConfig): Promise<StartContext | StartLlamaServerResult> {
  const binaryPath = await resolveServerBinaryPath(config);
  const baseUrl = buildBaseUrl(config);
  const modelPath = await resolveModelPath(config);

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
    baseUrl
  };
}

export async function startLlamaServer(config: AppConfig): Promise<StartLlamaServerResult> {
  const contextOrFailure = await createStartContext(config);
  if ("started" in contextOrFailure) {
    return contextOrFailure;
  }
  const context = contextOrFailure;

  if (runningState && runningState.baseUrl === context.baseUrl) {
    if (await checkLlamaHealth(context.baseUrl)) {
      return { started: false };
    }
    await stopLlamaServer();
  }

  const contextSize = config.llamaContextSize > 0 ? config.llamaContextSize : getOptimalContextSize();
  const gpuLayers = config.llamaGpuLayers > 0 ? config.llamaGpuLayers : 999;
  const args = [
    "-m",
    context.modelPath,
    "-c",
    String(contextSize),
    "--host",
    config.llamaHost,
    "--port",
    String(config.llamaPort),
    "--embedding",
    "--log-disable",
    "-ngl",
    String(gpuLayers)
  ];

  let process: ChildProcess;
  try {
    process = spawn(context.binaryPath, args, {
      stdio: "ignore"
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
      return startFailure(
        process.exitCode === 98 ? "port-unavailable" : "process-exited",
        `llama-server exited before becoming healthy (exit code ${String(process.exitCode)}).`,
        [`Binary: ${context.binaryPath}`, `Model: ${context.modelPath}`]
      );
    }
    if (await checkLlamaHealth(context.baseUrl)) {
      return { started: true };
    }
    await sleep(HEALTH_RETRY_INTERVAL_MS);
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

export async function ensureLlamaReady(config: AppConfig): Promise<EnsureLlamaReadyResult> {
  const baseUrl = buildBaseUrl(config);
  if (await checkLlamaHealth(baseUrl)) {
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

  const started = await startLlamaServer(config);
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
  for (const detail of failure.details) {
    lines.push(`- ${detail}`);
  }
  lines.push(`- Base URL: ${buildBaseUrl(config)}`);
  lines.push("- Verify llama-server is installed: which llama-server");
  lines.push(`- Verify model exists: ls ${resolve(config.llamaModelsDir, config.model)}`);
  return lines.join("\n");
}
