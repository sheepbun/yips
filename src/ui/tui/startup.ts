import { saveConfig } from "#config/config";
import { getSystemSpecs } from "#models/hardware";
import { formatLlamaStartupFailure, resetLlamaForFreshSession } from "#llm/llama-server";
import { listLocalModels, selectBestModelForHardware } from "#models/model-manager";
import type { TuiOptions } from "#types/app-types";

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

export async function applyHardwareAwareStartupModelSelection(
  options: TuiOptions,
  deps: {
    getSpecs: typeof getSystemSpecs;
    listModels: typeof listLocalModels;
    selectModel: typeof selectBestModelForHardware;
    save: typeof saveConfig;
  } = {
    getSpecs: getSystemSpecs,
    listModels: listLocalModels,
    selectModel: selectBestModelForHardware,
    save: saveConfig
  }
): Promise<string | null> {
  if (options.config.backend !== "llamacpp") {
    return null;
  }
  if (resolveLoadedModel(options.config.model)) {
    return null;
  }

  const specs = deps.getSpecs();
  const models = await deps.listModels({
    totalMemoryGb: specs.totalMemoryGb,
    nicknames: options.config.nicknames
  });
  const selected = deps.selectModel(models, specs);
  if (!selected) {
    return null;
  }

  options.config.model = selected.id;
  await deps.save(options.config);
  return selected.id;
}

export async function ensureFreshLlamaSessionOnStartup(
  options: TuiOptions,
  deps: { reset: typeof resetLlamaForFreshSession } = { reset: resetLlamaForFreshSession }
): Promise<void> {
  if (options.config.backend !== "llamacpp") {
    return;
  }
  const configuredModel = options.config.model.trim().toLowerCase();
  if (configuredModel.length === 0 || configuredModel === "default") {
    return;
  }

  const resetResult = await deps.reset(options.config);
  if (resetResult.failure) {
    throw new Error(formatLlamaStartupFailure(resetResult.failure, options.config));
  }
}
