import { constants as fsConstants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { AppConfig, Backend, LlamaPortConflictPolicy } from "./types";

type ConfigSource = "default" | "file";

export interface LoadConfigResult {
  config: AppConfig;
  path: string;
  source: ConfigSource;
  warning?: string;
}

const SUPPORTED_BACKENDS: ReadonlySet<Backend> = new Set(["llamacpp", "claude"]);
const PORT_CONFLICT_POLICIES: ReadonlySet<LlamaPortConflictPolicy> = new Set([
  "fail",
  "kill-llama",
  "kill-user"
]);
export const DEFAULT_CONFIG_PATH = ".yips_config.json";
export const CONFIG_PATH_ENV_VAR = "YIPS_CONFIG_PATH";

export function getDefaultConfig(): AppConfig {
  const llamaHost = "127.0.0.1";
  const llamaPort = 8080;
  return {
    streaming: true,
    verbose: false,
    backend: "llamacpp",
    llamaBaseUrl: buildBaseUrl(llamaHost, llamaPort),
    llamaServerPath: "",
    llamaModelsDir: resolve(homedir(), ".yips", "models"),
    llamaHost,
    llamaPort,
    llamaContextSize: 8192,
    llamaGpuLayers: 999,
    llamaAutoStart: true,
    llamaPortConflictPolicy: "kill-user",
    model: "default",
    tokensMode: "auto",
    tokensManualMax: 8192,
    nicknames: {}
  };
}

export function resolveConfigPath(configPath = DEFAULT_CONFIG_PATH): string {
  if (configPath === DEFAULT_CONFIG_PATH) {
    const envPath = process.env[CONFIG_PATH_ENV_VAR]?.trim();
    if (envPath && envPath.length > 0) {
      return resolve(envPath);
    }
  }
  return resolve(process.cwd(), configPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeBackend(value: unknown, fallback: Backend): Backend {
  if (typeof value === "string" && SUPPORTED_BACKENDS.has(value as Backend)) {
    return value as Backend;
  }

  return fallback;
}

function normalizeModel(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeHost(value: unknown, fallback: string): string {
  return normalizeString(value, fallback);
}

function normalizePort(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function normalizePortConflictPolicy(
  value: unknown,
  fallback: LlamaPortConflictPolicy
): LlamaPortConflictPolicy {
  if (typeof value === "string" && PORT_CONFLICT_POLICIES.has(value as LlamaPortConflictPolicy)) {
    return value as LlamaPortConflictPolicy;
  }
  return fallback;
}

function normalizeTokensMode(value: unknown, fallback: AppConfig["tokensMode"]): AppConfig["tokensMode"] {
  if (value === "auto" || value === "manual") {
    return value;
  }
  return fallback;
}

function buildBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function parseBaseUrlHostPort(baseUrl: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.hostname || !parsed.port) {
      return null;
    }
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    return {
      host: parsed.hostname,
      port
    };
  } catch {
    return null;
  }
}

function normalizeNicknames(
  value: unknown,
  fallback: Record<string, string>
): Record<string, string> {
  if (!isRecord(value)) {
    return { ...fallback };
  }

  const next: Record<string, string> = {};
  for (const [key, nickname] of Object.entries(value)) {
    if (typeof key !== "string" || typeof nickname !== "string") {
      continue;
    }
    const trimmedKey = key.trim();
    const trimmedNickname = nickname.trim();
    if (trimmedKey.length === 0 || trimmedNickname.length === 0) {
      continue;
    }
    next[trimmedKey] = trimmedNickname;
  }

  return next;
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const envHost = normalizeHost(process.env["YIPS_LLAMA_HOST"], config.llamaHost);
  const envPort = normalizePort(process.env["YIPS_LLAMA_PORT"], config.llamaPort);
  const envBaseUrl = normalizeBaseUrl(
    process.env["YIPS_LLAMA_BASE_URL"],
    buildBaseUrl(envHost, envPort)
  );
  const envBaseUrlHostPort = parseBaseUrlHostPort(envBaseUrl);

  return {
    ...config,
    llamaHost: envBaseUrlHostPort?.host ?? envHost,
    llamaPort: envBaseUrlHostPort?.port ?? envPort,
    llamaBaseUrl: envBaseUrl,
    llamaServerPath: normalizeString(process.env["YIPS_LLAMA_SERVER_PATH"], config.llamaServerPath),
    llamaModelsDir: normalizeString(process.env["YIPS_LLAMA_MODELS_DIR"], config.llamaModelsDir),
    llamaContextSize: normalizePositiveInt(
      process.env["YIPS_LLAMA_CONTEXT_SIZE"],
      config.llamaContextSize
    ),
    llamaGpuLayers: normalizePositiveInt(process.env["YIPS_LLAMA_GPU_LAYERS"], config.llamaGpuLayers),
    llamaAutoStart: parseBoolean(process.env["YIPS_LLAMA_AUTO_START"], config.llamaAutoStart),
    llamaPortConflictPolicy: normalizePortConflictPolicy(
      process.env["YIPS_LLAMA_PORT_CONFLICT_POLICY"],
      config.llamaPortConflictPolicy
    ),
    model: normalizeModel(process.env["YIPS_MODEL"], config.model),
    tokensMode: normalizeTokensMode(process.env["YIPS_TOKENS_MODE"], config.tokensMode),
    tokensManualMax: normalizePositiveInt(process.env["YIPS_TOKENS_MANUAL_MAX"], config.tokensManualMax)
  };
}

export function mergeConfig(defaults: AppConfig, candidate: unknown): AppConfig {
  if (!isRecord(candidate)) {
    return defaults;
  }

  const llamaHost = normalizeHost(candidate.llamaHost, defaults.llamaHost);
  const llamaPort = normalizePort(candidate.llamaPort, defaults.llamaPort);
  const llamaBaseUrl = normalizeBaseUrl(candidate.llamaBaseUrl, buildBaseUrl(llamaHost, llamaPort));
  const baseUrlHostPort = parseBaseUrlHostPort(llamaBaseUrl);

  return {
    streaming: normalizeBoolean(candidate.streaming, defaults.streaming),
    verbose: normalizeBoolean(candidate.verbose, defaults.verbose),
    backend: normalizeBackend(candidate.backend, defaults.backend),
    llamaBaseUrl,
    llamaServerPath: normalizeString(candidate.llamaServerPath, defaults.llamaServerPath),
    llamaModelsDir: normalizeString(candidate.llamaModelsDir, defaults.llamaModelsDir),
    llamaHost: baseUrlHostPort?.host ?? llamaHost,
    llamaPort: baseUrlHostPort?.port ?? llamaPort,
    llamaContextSize: normalizePositiveInt(candidate.llamaContextSize, defaults.llamaContextSize),
    llamaGpuLayers: normalizePositiveInt(candidate.llamaGpuLayers, defaults.llamaGpuLayers),
    llamaAutoStart: normalizeBoolean(candidate.llamaAutoStart, defaults.llamaAutoStart),
    llamaPortConflictPolicy: normalizePortConflictPolicy(
      candidate.llamaPortConflictPolicy,
      defaults.llamaPortConflictPolicy
    ),
    model: normalizeModel(candidate.model, defaults.model),
    tokensMode: normalizeTokensMode(candidate.tokensMode, defaults.tokensMode),
    tokensManualMax: normalizePositiveInt(candidate.tokensManualMax, defaults.tokensManualMax),
    nicknames: normalizeNicknames(candidate.nicknames, defaults.nicknames)
  };
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LoadConfigResult> {
  const defaults = getDefaultConfig();
  const path = resolveConfigPath(configPath);
  const legacyDefaultPath = resolve(process.cwd(), DEFAULT_CONFIG_PATH);
  const candidatePaths: string[] = [path];

  if (configPath === DEFAULT_CONFIG_PATH && path !== legacyDefaultPath) {
    candidatePaths.push(legacyDefaultPath);
  }

  let readablePath: string | null = null;
  for (const candidatePath of candidatePaths) {
    try {
      await access(candidatePath, fsConstants.R_OK);
      readablePath = candidatePath;
      break;
    } catch {
      // keep trying
    }
  }

  if (!readablePath) {
    return { config: applyEnvOverrides(defaults), path, source: "default" };
  }

  try {
    const rawConfig = await readFile(readablePath, "utf8");
    const parsedConfig: unknown = JSON.parse(rawConfig);

    return {
      config: applyEnvOverrides(mergeConfig(defaults, parsedConfig)),
      path: readablePath,
      source: "file"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: applyEnvOverrides(defaults),
      path: readablePath,
      source: "default",
      warning: `Failed to load config at ${readablePath}: ${message}`
    };
  }
}

export async function saveConfig(
  config: AppConfig,
  configPath = DEFAULT_CONFIG_PATH
): Promise<void> {
  const path = resolveConfigPath(configPath);
  const normalized = mergeConfig(getDefaultConfig(), config);
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function updateConfig(
  patch: Partial<AppConfig>,
  configPath = DEFAULT_CONFIG_PATH
): Promise<AppConfig> {
  const loaded = await loadConfig(configPath);
  const merged = mergeConfig(getDefaultConfig(), { ...loaded.config, ...patch });
  await saveConfig(merged, configPath);
  return merged;
}
