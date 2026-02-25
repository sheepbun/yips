import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listMemories, readMemory, saveMemory } from "../src/memory-store";

const originalMemoriesDir = process.env["YIPS_MEMORIES_DIR"];

afterEach(() => {
  if (originalMemoriesDir === undefined) {
    delete process.env["YIPS_MEMORIES_DIR"];
  } else {
    process.env["YIPS_MEMORIES_DIR"] = originalMemoriesDir;
  }
});

describe("memory-store", () => {
  it("saves and lists memories in reverse chronological order", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-memory-store-list-"));
    process.env["YIPS_MEMORIES_DIR"] = root;

    try {
      await saveMemory("Older note", new Date("2026-02-20T10:00:00.000Z"));
      await saveMemory("Newer note", new Date("2026-02-20T11:00:00.000Z"));

      const items = await listMemories();
      expect(items).toHaveLength(2);
      expect(items[0]?.preview).toContain("Newer note");
      expect(items[1]?.preview).toContain("Older note");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a saved memory by id", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-memory-store-read-"));
    process.env["YIPS_MEMORIES_DIR"] = root;

    try {
      const saved = await saveMemory("Remember the command palette shortcut");
      const loaded = await readMemory(saved.id);
      expect(loaded.content).toContain("Remember the command palette shortcut");
      expect(loaded.id).toBe(saved.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects empty memory content", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-memory-store-empty-"));
    process.env["YIPS_MEMORIES_DIR"] = root;

    try {
      await expect(saveMemory("   ")).rejects.toThrow("Cannot save empty memory.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
