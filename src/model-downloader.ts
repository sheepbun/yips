import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";

export interface HfModelSummary {
  id: string;
  downloads: number;
  likes: number;
  lastModified: string;
  sizeBytes: number | null;
  canRun: boolean;
  reason: string;
}

export interface HfModelFile {
  path: string;
  sizeBytes: number | null;
  quant: string;
  canRun: boolean;
  reason: string;
}

export interface ParsedHfDownloadUrl {
  repoId: string;
  revision: string;
  filename: string;
}

export interface DownloadModelFileOptions {
  repoId: string;
  filename: string;
  revision?: string;
  modelsDir?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (event: { bytesDownloaded: number; totalBytes: number | null }) => void;
}

export interface DownloadModelFileResult {
  localPath: string;
  byteCount: number;
}

export type HfModelSort = "downloads" | "likes" | "trendingScore" | "lastModified";

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toPositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function toDateText(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function safeRelativePath(path: string): string {
  const normalized = normalize(path).replace(/^[\\/]+/u, "");
  const segments = normalized.split(/[\\/]/u).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Unsafe filename: ${path}`);
  }
  if (segments.length === 0) {
    throw new Error("Filename cannot be empty.");
  }
  return segments.join("/");
}

function extractSizeBytes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const direct = source.total;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const lfs = source.lfs;
  if (typeof lfs === "object" && lfs !== null) {
    const lfsSize = (lfs as Record<string, unknown>).size;
    if (typeof lfsSize === "number" && Number.isFinite(lfsSize) && lfsSize > 0) {
      return lfsSize;
    }
  }

  return null;
}

function evaluateSuitability(
  sizeBytes: number | null,
  totalMemoryGb?: number
): {
  canRun: boolean;
  reason: string;
} {
  if (sizeBytes === null) {
    return { canRun: true, reason: "Unknown size" };
  }

  if (typeof totalMemoryGb !== "number" || !Number.isFinite(totalMemoryGb) || totalMemoryGb <= 0) {
    return { canRun: true, reason: "No memory limit" };
  }

  const memoryLimitMultiplier = 1.2;
  const sizeGb = sizeBytes / (1024 * 1024 * 1024);
  const effectiveLimit = totalMemoryGb * memoryLimitMultiplier;
  if (sizeGb <= effectiveLimit) {
    return { canRun: true, reason: "Fits RAM+VRAM" };
  }

  return {
    canRun: false,
    reason: `Model too large (${sizeGb.toFixed(1)}GB > ${effectiveLimit.toFixed(1)}GB)`
  };
}

function extractQuant(path: string): string {
  const upper = path.toUpperCase();
  if (upper.includes("Q4_K_M")) return "Q4_K_M (Balanced)";
  if (upper.includes("Q5_K_M")) return "Q5_K_M (High Quality)";
  if (upper.includes("Q8_0")) return "Q8_0 (Max Quality)";
  if (upper.includes("Q2_K")) return "Q2_K (Max Speed)";

  const match = upper.match(/(Q\d+_[A-Z0-9_]+)/u);
  return match?.[1] ?? "Unknown";
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

export function resolveDefaultModelsDir(): string {
  const env = process.env["YIPS_MODELS_DIR"]?.trim();
  if (env && env.length > 0) {
    return env;
  }
  return join(homedir(), ".yips", "models");
}

export function isHfDownloadUrl(input: string): boolean {
  try {
    parseHfDownloadUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function parseHfDownloadUrl(input: string): ParsedHfDownloadUrl {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new Error("URL is required.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "hf.co" && host !== "huggingface.co" && host !== "www.huggingface.co") {
    throw new Error("URL must be from hf.co or huggingface.co.");
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 5) {
    throw new Error("URL must include /<owner>/<repo>/resolve/<revision>/<file>.gguf");
  }

  const resolveIndex = segments.findIndex((segment) => segment === "resolve");
  if (resolveIndex !== 2 || segments.length < 5) {
    throw new Error("URL must include /<owner>/<repo>/resolve/<revision>/<file>.gguf");
  }

  const owner = segments[0] ?? "";
  const repo = segments[1] ?? "";
  const revision = segments[3] ?? "main";
  const filenameSegments = segments.slice(4);
  const filename = filenameSegments.join("/");

  if (!filename.toLowerCase().endsWith(".gguf")) {
    throw new Error("URL must point to a .gguf file.");
  }

  return {
    repoId: `${owner}/${repo}`,
    revision,
    filename
  };
}

export async function listGgufModels(options?: {
  query?: string;
  sort?: HfModelSort;
  limit?: number;
  totalMemoryGb?: number;
  fetchImpl?: typeof fetch;
}): Promise<HfModelSummary[]> {
  const query = options?.query?.trim() ?? "";
  const sort: HfModelSort = options?.sort ?? "downloads";
  const limit = Math.max(1, Math.min(100, options?.limit ?? 10));

  const requestModels = async (expanded: boolean): Promise<unknown[]> => {
    const url = new URL("https://huggingface.co/api/models");
    url.searchParams.set("filter", "gguf");
    url.searchParams.set("sort", sort);
    url.searchParams.set("limit", String(limit));
    if (expanded) {
      url.searchParams.append("expand", "downloads");
      url.searchParams.append("expand", "likes");
      url.searchParams.append("expand", "lastModified");
      url.searchParams.append("expand", "gguf");
    }
    if (query.length > 0) {
      url.searchParams.set("search", query);
    }
    const response = await getFetch(options?.fetchImpl)(url);
    return readJson<unknown[]>(response);
  };

  let data: unknown[];
  try {
    data = await requestModels(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("HTTP 400") && !message.includes("HTTP 422")) {
      throw error;
    }
    data = await requestModels(false);
  }

  return data
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const model = item as Record<string, unknown>;
      const id = typeof model.id === "string" ? model.id : "";
      if (id.trim().length === 0) {
        return null;
      }

      const sizeBytes = extractSizeBytes(model.gguf);
      const suitability = evaluateSuitability(sizeBytes, options?.totalMemoryGb);

      return {
        id,
        downloads: toPositiveInt(model.downloads),
        likes: toPositiveInt(model.likes),
        lastModified: toDateText(model.lastModified),
        sizeBytes,
        canRun: suitability.canRun,
        reason: suitability.reason
      };
    })
    .filter((entry): entry is HfModelSummary => entry !== null)
    .filter((entry) => entry.canRun || entry.sizeBytes === null);
}

export async function listModelFiles(
  repoId: string,
  options?: { totalMemoryGb?: number; fetchImpl?: typeof fetch }
): Promise<HfModelFile[]> {
  const trimmedRepo = repoId.trim();
  if (trimmedRepo.length === 0) {
    throw new Error("Repository id is required.");
  }

  const encodedRepo = encodePath(trimmedRepo);
  const url = new URL(`https://huggingface.co/api/models/${encodedRepo}`);
  url.searchParams.set("blobs", "true");

  const response = await getFetch(options?.fetchImpl)(url);
  const data = await readJson<Record<string, unknown>>(response);
  const siblingsValue = data.siblings;
  const siblings = Array.isArray(siblingsValue) ? siblingsValue : [];

  const files = siblings
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const file = item as Record<string, unknown>;
      const path = typeof file.rfilename === "string" ? file.rfilename : "";
      if (!path.toLowerCase().endsWith(".gguf")) {
        return null;
      }

      const sizeBytes = extractSizeBytes(file.size ?? file.lfs ?? null);
      const suitability = evaluateSuitability(sizeBytes, options?.totalMemoryGb);

      return {
        path,
        sizeBytes,
        quant: extractQuant(path),
        canRun: suitability.canRun,
        reason: suitability.reason
      };
    })
    .filter((entry): entry is HfModelFile => entry !== null);

  files.sort((left, right) => {
    const leftSize = left.sizeBytes ?? Number.MAX_SAFE_INTEGER;
    const rightSize = right.sizeBytes ?? Number.MAX_SAFE_INTEGER;
    if (leftSize !== rightSize) {
      return leftSize - rightSize;
    }
    return left.path.localeCompare(right.path);
  });

  return files;
}

export async function downloadModelFile(
  options: DownloadModelFileOptions
): Promise<DownloadModelFileResult> {
  const repoId = options.repoId.trim();
  if (repoId.length === 0) {
    throw new Error("Repository id is required.");
  }

  const safeFilename = safeRelativePath(options.filename.trim());
  const modelsDir = options.modelsDir?.trim() || resolveDefaultModelsDir();
  const repoPath = safeRelativePath(repoId);
  const outputPath = resolve(modelsDir, repoPath, safeFilename);
  const revision = options.revision?.trim() || "main";

  await mkdir(dirname(outputPath), { recursive: true });

  let byteCount = 0;
  let completed = false;

  try {
    const fileUrl =
      `https://huggingface.co/${encodePath(repoId)}/resolve/${encodeURIComponent(revision)}/` +
      `${encodePath(safeFilename)}?download=true`;
    const response = await getFetch(options.fetchImpl)(fileUrl, { signal: options.signal });

    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Download failed: response body is empty.");
    }

    const contentLengthHeader = response.headers.get("content-length");
    const parsedLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : Number.NaN;
    const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;

    const emitProgress = (bytesDownloaded: number): void => {
      if (!options.onProgress) {
        return;
      }
      options.onProgress({
        bytesDownloaded,
        totalBytes
      });
    };

    emitProgress(byteCount);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const writer = createWriteStream(outputPath);

      writer.on("error", rejectPromise);
      writer.on("finish", resolvePromise);

      const reader = response.body?.getReader();
      if (!reader) {
        writer.destroy(new Error("Download failed: could not create stream reader."));
        return;
      }

      const pump = async (): Promise<void> => {
        try {
          let reading = true;
          while (reading) {
            const chunk = await reader.read();
            if (chunk.done) {
              writer.end();
              reading = false;
              continue;
            }
            const value = chunk.value;
            byteCount += value.byteLength;
            emitProgress(byteCount);
            if (!writer.write(Buffer.from(value))) {
              await new Promise<void>((drainResolve) => {
                writer.once("drain", drainResolve);
              });
            }
          }
        } catch (error) {
          writer.destroy(error instanceof Error ? error : new Error(String(error)));
        }
      };

      void pump();
    });

    emitProgress(byteCount);
    completed = true;
    return { localPath: outputPath, byteCount };
  } catch (error) {
    if (!completed) {
      try {
        await rm(outputPath, { force: true });
      } catch {
        // Preserve the original download error when cleanup fails.
      }
    }
    throw error;
  }
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) {
    return "unknown";
  }
  const gib = bytes / (1024 * 1024 * 1024);
  return `${gib.toFixed(2)} GB`;
}

export function renderModelList(models: readonly HfModelSummary[]): string {
  if (models.length === 0) {
    return "No GGUF models found.";
  }

  const rows = models.map((model, index) => {
    const date = model.lastModified === "unknown" ? "unknown" : model.lastModified.slice(0, 10);
    return `${index + 1}. ${model.id}  (downloads ${formatCount(model.downloads)}, likes ${formatCount(model.likes)}, size ${formatSize(model.sizeBytes)}, updated ${date})`;
  });

  return rows.join("\n");
}

export function renderFileList(files: readonly HfModelFile[]): string {
  if (files.length === 0) {
    return "No GGUF files found for this repository.";
  }

  return files
    .map(
      (file, index) =>
        `${index + 1}. ${file.path}  (${formatSize(file.sizeBytes)}, ${file.quant}, ${file.reason})`
    )
    .join("\n");
}
