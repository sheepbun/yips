import { getFriendlyModelName } from "#models/model-manager";
import type { AppConfig } from "#types/app-types";

function resolveLoadedModel(model: string): string | null {
  const trimmed = model.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}

export function resolveModelLoadTarget(config: AppConfig): "GPU" | "CPU" {
  return config.llamaGpuLayers > 0 ? "GPU" : "CPU";
}

export function formatModelLoadingLabel(
  config: AppConfig,
  nicknames: Record<string, string>
): string {
  const loadedModel = resolveLoadedModel(config.model);
  const modelLabel = loadedModel ? getFriendlyModelName(loadedModel, nicknames) : "model";
  const target = resolveModelLoadTarget(config);
  return `Loading ${modelLabel} into ${target}...`;
}

export async function runOnceGuarded(
  guard: { current: boolean },
  operation: () => Promise<void>
): Promise<boolean> {
  if (guard.current) {
    return false;
  }
  guard.current = true;
  await operation();
  return true;
}

export function computeTokensPerSecond(tokens: number, durationMs: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(durationMs)) {
    return null;
  }
  if (tokens <= 0 || durationMs <= 0) {
    return null;
  }
  return tokens / (durationMs / 1000);
}

export function formatTokensPerSecond(tokensPerSecond: number): string {
  const safe = Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? tokensPerSecond : 0;
  return `${safe.toFixed(1)} tk/s`;
}

export function formatTitleCwd(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : "/";
}
