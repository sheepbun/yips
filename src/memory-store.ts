import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const DEFAULT_MEMORY_DIR = join(homedir(), ".yips", "memories");
const MEMORY_DIR_ENV = "YIPS_MEMORIES_DIR";

export interface MemoryItem {
  id: string;
  path: string;
  title: string;
  createdAt: Date;
  preview: string;
}

export interface LoadedMemory extends MemoryItem {
  content: string;
}

function resolveMemoryDir(): string {
  const override = process.env[MEMORY_DIR_ENV]?.trim();
  if (override && override.length > 0) {
    return override;
  }
  return DEFAULT_MEMORY_DIR;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toMemoryTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    "-",
    pad2(now.getMonth() + 1),
    "-",
    pad2(now.getDate()),
    "_",
    pad2(now.getHours()),
    "-",
    pad2(now.getMinutes()),
    "-",
    pad2(now.getSeconds())
  ].join("");
}

function slugifyTitle(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .trim()
    .replace(/\s+/gu, "-")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  return base.length > 0 ? base : "memory";
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\r\n/gu, "\n");
}

function parseFileStem(path: string): { createdAt: Date; slug: string } {
  const stem = basename(path, ".md");
  const splitIndex = stem.indexOf("_");
  if (splitIndex <= 0) {
    return { createdAt: new Date(0), slug: stem };
  }

  const datePart = stem.slice(0, splitIndex);
  const remainder = stem.slice(splitIndex + 1);
  const secondSplit = remainder.indexOf("_");
  if (secondSplit <= 0) {
    return { createdAt: new Date(0), slug: stem };
  }

  const timePart = remainder.slice(0, secondSplit);
  const slug = remainder.slice(secondSplit + 1);
  const timestamp = new Date(`${datePart}T${timePart.replace(/-/gu, ":")}`);
  if (Number.isNaN(timestamp.valueOf())) {
    return { createdAt: new Date(0), slug };
  }
  return { createdAt: timestamp, slug };
}

function extractBody(content: string): string {
  const marker = "## Memory";
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    return content.trim();
  }
  return content.slice(markerIndex + marker.length).trim();
}

function previewOf(content: string): string {
  const firstLine = extractBody(content)
    .split(/\n/gu)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "(empty memory)";
  }
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
}

export async function saveMemory(content: string, now: Date = new Date()): Promise<MemoryItem> {
  const normalized = normalizeContent(content);
  if (normalized.length === 0) {
    throw new Error("Cannot save empty memory.");
  }

  const memoryDir = resolveMemoryDir();
  await mkdir(memoryDir, { recursive: true });

  const titleSource = normalized.split(/\n/gu)[0] ?? "memory";
  const slug = slugifyTitle(titleSource);
  const id = `${toMemoryTimestamp(now)}_${slug}`;
  const path = join(memoryDir, `${id}.md`);
  const body = [
    "# Memory",
    "",
    `**Created**: ${now.toISOString()}`,
    "",
    "## Memory",
    "",
    normalized,
    ""
  ].join("\n");

  await writeFile(path, body, "utf8");

  return {
    id,
    path,
    title: titleSource.trim().slice(0, 96),
    createdAt: now,
    preview: previewOf(body)
  };
}

export async function listMemories(limit?: number): Promise<MemoryItem[]> {
  const memoryDir = resolveMemoryDir();
  try {
    const entries = await readdir(memoryDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => join(memoryDir, entry.name));

    const loaded = await Promise.all(
      files.map(async (path) => {
        const text = await readFile(path, "utf8");
        const parsed = parseFileStem(path);
        return {
          id: basename(path, ".md"),
          path,
          title: parsed.slug.replace(/-/gu, " ").trim() || "memory",
          createdAt: parsed.createdAt,
          preview: previewOf(text)
        } satisfies MemoryItem;
      })
    );

    const sorted = loaded.sort(
      (left, right) => right.createdAt.valueOf() - left.createdAt.valueOf()
    );
    return typeof limit === "number" && limit > 0 ? sorted.slice(0, limit) : sorted;
  } catch {
    return [];
  }
}

export async function readMemory(id: string): Promise<LoadedMemory> {
  const normalizedId = id.trim().replace(/\.md$/iu, "");
  if (normalizedId.length === 0) {
    throw new Error("Memory id is required.");
  }

  const path = join(resolveMemoryDir(), `${normalizedId}.md`);
  const text = await readFile(path, "utf8");
  const parsed = parseFileStem(path);
  const content = extractBody(text);
  return {
    id: normalizedId,
    path,
    title: parsed.slug.replace(/-/gu, " ").trim() || "memory",
    createdAt: parsed.createdAt,
    preview: previewOf(text),
    content
  };
}
