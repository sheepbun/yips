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
    backend: "llamacpp"
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

export function mergeConfig(defaults: AppConfig, candidate: unknown): AppConfig {
  if (!isRecord(candidate)) {
    return defaults;
  }

  return {
    streaming: normalizeBoolean(candidate.streaming, defaults.streaming),
    verbose: normalizeBoolean(candidate.verbose, defaults.verbose),
    backend: normalizeBackend(candidate.backend, defaults.backend)
  };
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LoadConfigResult> {
  const path = resolveConfigPath(configPath);
  const defaults = getDefaultConfig();

  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return { config: defaults, path, source: "default" };
  }

  try {
    const rawConfig = await readFile(path, "utf8");
    const parsedConfig: unknown = JSON.parse(rawConfig);

    return {
      config: mergeConfig(defaults, parsedConfig),
      path,
      source: "file"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: defaults,
      path,
      source: "default",
      warning: `Failed to load config at ${path}: ${message}`
    };
  }
}
