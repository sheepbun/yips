import { readdir, rmdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { resolveDefaultModelsDir } from "./model-downloader";

export interface ModelManagerModel {
  id: string;
  name: string;
  friendlyName: string;
  host: string;
  backend: "llamacpp";
  friendlyBackend: "llama.cpp";
  sizeBytes: number;
  sizeGb: number;
  canRun: boolean;
  reason: string;
  path: string;
}

const MEMORY_LIMIT_MULTIPLIER = 1.2;

function evaluateSuitability(
  sizeBytes: number,
  totalMemoryGb?: number
): {
  canRun: boolean;
  reason: string;
} {
  if (typeof totalMemoryGb !== "number" || !Number.isFinite(totalMemoryGb) || totalMemoryGb <= 0) {
    return { canRun: true, reason: "No memory limit" };
  }

  const sizeGb = sizeBytes / 1024 ** 3;
  const effectiveLimit = totalMemoryGb * MEMORY_LIMIT_MULTIPLIER;
  if (sizeGb <= effectiveLimit) {
    return { canRun: true, reason: "Fits RAM+VRAM" };
  }

  return {
    canRun: false,
    reason: `Model too large (${sizeGb.toFixed(1)}GB > ${effectiveLimit.toFixed(1)}GB)`
  };
}

function toFriendlyNameFallback(modelId: string): string {
  const filename = basename(modelId);
  if (filename.toLowerCase().endsWith(".gguf")) {
    return filename.slice(0, -5);
  }
  return filename;
}

export function getFriendlyModelName(modelId: string, nicknames: Record<string, string>): string {
  const exact = nicknames[modelId];
  if (typeof exact === "string" && exact.trim().length > 0) {
    return exact.trim();
  }

  const fallback = toFriendlyNameFallback(modelId);
  const byFilename = nicknames[fallback];
  if (typeof byFilename === "string" && byFilename.trim().length > 0) {
    return byFilename.trim();
  }

  return fallback;
}

async function collectGgufPaths(root: string, base = root): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await collectGgufPaths(absolutePath, base)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (extname(entry.name).toLowerCase() !== ".gguf") {
      continue;
    }

    const rel = relative(base, absolutePath).replace(/\\/gu, "/");
    paths.push(rel);
  }

  return paths;
}

export async function listLocalModels(options?: {
  modelsDir?: string;
  totalMemoryGb?: number;
  nicknames?: Record<string, string>;
}): Promise<ModelManagerModel[]> {
  const modelsDir = resolve(options?.modelsDir?.trim() || resolveDefaultModelsDir());
  const nicknames = options?.nicknames ?? {};

  let modelIds: string[] = [];
  try {
    modelIds = await collectGgufPaths(modelsDir);
  } catch {
    return [];
  }

  const rows: ModelManagerModel[] = [];

  for (const modelId of modelIds.sort((left, right) => left.localeCompare(right))) {
    const path = join(modelsDir, modelId);
    let sizeBytes = 0;

    try {
      const stats = await stat(path);
      sizeBytes = stats.isFile() ? stats.size : 0;
    } catch {
      continue;
    }

    const parts = modelId.split("/");
    const host = parts.length > 1 ? (parts[0] ?? "Local") : "Local";
    const suitability = evaluateSuitability(sizeBytes, options?.totalMemoryGb);

    rows.push({
      id: modelId,
      name: toFriendlyNameFallback(modelId),
      friendlyName: getFriendlyModelName(modelId, nicknames),
      host,
      backend: "llamacpp",
      friendlyBackend: "llama.cpp",
      sizeBytes,
      sizeGb: sizeBytes / 1024 ** 3,
      canRun: suitability.canRun,
      reason: suitability.reason,
      path
    });
  }

  return rows;
}

export function filterModels(
  models: readonly ModelManagerModel[],
  query: string
): ModelManagerModel[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [...models];
  }

  return models.filter((model) =>
    [model.id, model.name, model.friendlyName, model.host].some((value) =>
      value.toLowerCase().includes(trimmed)
    )
  );
}

export function findMatchingModel(
  models: readonly ModelManagerModel[],
  input: string
): ModelManagerModel | null {
  const needle = input.trim().toLowerCase();
  if (needle.length === 0) {
    return null;
  }

  const exact = models.find(
    (model) =>
      model.id.toLowerCase() === needle ||
      model.name.toLowerCase() === needle ||
      basename(model.id).toLowerCase() === needle
  );
  if (exact) {
    return exact;
  }

  const partial = models.find(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      model.name.toLowerCase().includes(needle) ||
      basename(model.id).toLowerCase().includes(needle)
  );

  return partial ?? null;
}

async function pruneEmptyParents(path: string, root: string): Promise<void> {
  let current = dirname(path);
  const normalizedRoot = resolve(root);

  while (current.startsWith(normalizedRoot) && current !== normalizedRoot) {
    try {
      const entries = await readdir(current);
      if (entries.length > 0) {
        return;
      }
      await rmdir(current);
      current = dirname(current);
    } catch {
      return;
    }
  }
}

export async function deleteLocalModel(
  model: ModelManagerModel,
  options?: { modelsDir?: string }
): Promise<void> {
  const modelsDir = resolve(options?.modelsDir?.trim() || resolveDefaultModelsDir());
  const modelPath = resolve(model.path);
  const expectedPrefix = `${modelsDir}${sep}`;

  if (modelPath !== modelsDir && !modelPath.startsWith(expectedPrefix)) {
    throw new Error("Refusing to delete model outside models directory.");
  }

  await unlink(modelPath);
  await pruneEmptyParents(modelPath, modelsDir);
}
