import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AppConfig, Backend } from "./types";

type ConfigSource = "default" | "file";

export interface LoadConfigResult {
  config: AppConfig;
  path: string;
  source: ConfigSource;
  warning?: string;
}

const SUPPORTED_BACKENDS: ReadonlySet<Backend> = new Set(["llamacpp", "claude"]);
export const DEFAULT_CONFIG_PATH = ".yips_config.json";

export function getDefaultConfig(): AppConfig {
  return {
    streaming: true,
    verbose: false,
    backend: "llamacpp",
    llamaBaseUrl: "http://127.0.0.1:8080",
    model: "default"
  };
}

export function resolveConfigPath(configPath = DEFAULT_CONFIG_PATH): string {
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

function applyEnvOverrides(config: AppConfig): AppConfig {
  return {
    ...config,
    llamaBaseUrl: normalizeBaseUrl(process.env["YIPS_LLAMA_BASE_URL"], config.llamaBaseUrl),
    model: normalizeModel(process.env["YIPS_MODEL"], config.model)
  };
}

export function mergeConfig(defaults: AppConfig, candidate: unknown): AppConfig {
  if (!isRecord(candidate)) {
    return defaults;
  }

  return {
    streaming: normalizeBoolean(candidate.streaming, defaults.streaming),
    verbose: normalizeBoolean(candidate.verbose, defaults.verbose),
    backend: normalizeBackend(candidate.backend, defaults.backend),
    llamaBaseUrl: normalizeBaseUrl(candidate.llamaBaseUrl, defaults.llamaBaseUrl),
    model: normalizeModel(candidate.model, defaults.model)
  };
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LoadConfigResult> {
  const path = resolveConfigPath(configPath);
  const defaults = getDefaultConfig();

  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return { config: applyEnvOverrides(defaults), path, source: "default" };
  }

  try {
    const rawConfig = await readFile(path, "utf8");
    const parsedConfig: unknown = JSON.parse(rawConfig);

    return {
      config: applyEnvOverrides(mergeConfig(defaults, parsedConfig)),
      path,
      source: "file"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: applyEnvOverrides(defaults),
      path,
      source: "default",
      warning: `Failed to load config at ${path}: ${message}`
    };
  }
}
