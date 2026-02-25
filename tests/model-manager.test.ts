import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deleteLocalModel,
  filterModels,
  findMatchingModel,
  getModelDisplayName,
  getFriendlyModelName,
  listLocalModels,
  selectBestModelForHardware
} from "../src/model-manager";

describe("model-manager", () => {
  it("lists local GGUF models from nested directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-model-manager-"));
    const modelDir = join(root, "org", "repo");
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, "model-q4.gguf"), "binary", "utf8");

    try {
      const models = await listLocalModels({
        modelsDir: root,
        totalMemoryGb: 32,
        nicknames: { "org/repo/model-q4.gguf": "q4-fast" }
      });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: "org/repo/model-q4.gguf",
        host: "org",
        friendlyName: "q4-fast",
        backend: "llamacpp",
        friendlyBackend: "llama.cpp"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds exact and partial model matches", () => {
    const models = [
      {
        id: "a/b/model-a.gguf",
        name: "model-a",
        friendlyName: "model-a",
        host: "a",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 100,
        sizeGb: 0.1,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/a/b/model-a.gguf"
      },
      {
        id: "x/y/model-b.gguf",
        name: "model-b",
        friendlyName: "model-b",
        host: "x",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 100,
        sizeGb: 0.1,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/x/y/model-b.gguf"
      }
    ];

    expect(findMatchingModel(models, "model-a")).toBe(models[0]);
    expect(findMatchingModel(models, "model-b.gguf")).toBe(models[1]);
    expect(findMatchingModel(models, "x/y/model-b")).toBe(models[1]);
  });

  it("filters models by query", () => {
    const models = [
      {
        id: "org/foo/a.gguf",
        name: "a",
        friendlyName: "alpha",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 1,
        sizeGb: 0,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/a.gguf"
      },
      {
        id: "org/bar/b.gguf",
        name: "b",
        friendlyName: "beta",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 1,
        sizeGb: 0,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/b.gguf"
      }
    ];

    const filtered = filterModels(models, "beta");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("org/bar/b.gguf");
  });

  it("deletes a local model and prunes empty parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-model-manager-delete-"));
    const modelDir = join(root, "org", "repo");
    const modelPath = join(modelDir, "model-q4.gguf");
    await mkdir(modelDir, { recursive: true });
    await writeFile(modelPath, "binary", "utf8");

    try {
      await deleteLocalModel(
        {
          id: "org/repo/model-q4.gguf",
          name: "model-q4",
          friendlyName: "model-q4",
          host: "org",
          backend: "llamacpp",
          friendlyBackend: "llama.cpp",
          sizeBytes: 1,
          sizeGb: 0,
          canRun: true,
          reason: "Fits RAM+VRAM",
          path: modelPath
        },
        { modelsDir: root }
      );

      const models = await listLocalModels({ modelsDir: root });
      expect(models).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses nickname fallback by filename", () => {
    const friendly = getFriendlyModelName("org/repo/qwen.gguf", { qwen: "qwen-3" });
    expect(friendly).toBe("qwen-3");
  });

  it("prefers exact model-id nickname when present", () => {
    const friendly = getFriendlyModelName("org/repo/model-q4.gguf", {
      "org/repo/model-q4.gguf": "q4-fast",
      repo: "repo-nick"
    });
    expect(friendly).toBe("q4-fast");
  });

  it("uses parent folder as the default name for nested model variants", () => {
    const friendly = getFriendlyModelName(
      "Qwen/Qwen3-VL-2B-Instruct-GGUF/Qwen3VL-2B-Instruct-Q4_K_M.gguf",
      {}
    );
    expect(friendly).toBe("Qwen3-VL-2B-Instruct-GGUF");
  });

  it("uses parent folder as model name when listing local models", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-model-manager-parent-name-"));
    const modelDir = join(root, "Qwen", "Qwen3-VL-2B-Instruct-GGUF");
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, "Qwen3VL-2B-Instruct-Q4_K_M.gguf"), "binary", "utf8");

    try {
      const models = await listLocalModels({ modelsDir: root });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe("Qwen3-VL-2B-Instruct-GGUF");
      expect(models[0]?.friendlyName).toBe("Qwen3-VL-2B-Instruct-GGUF");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses repo directory as default name for owner/repo/model paths", () => {
    const friendly = getFriendlyModelName("org/repo/model-q4.gguf", {});
    expect(friendly).toBe("repo");
  });

  it("returns display name from parent folder for nested gguf model paths", () => {
    expect(getModelDisplayName("Qwen/Qwen3-VL-2B-Instruct-GGUF/Qwen3VL-2B-Instruct-Q4_K_M.gguf")).toBe(
      "Qwen3-VL-2B-Instruct-GGUF"
    );
  });

  it("selects the largest runnable model that fits VRAM when GPU memory is available", () => {
    const models = [
      {
        id: "org/repo/q4.gguf",
        name: "q4",
        friendlyName: "q4",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 4 * 1024 ** 3,
        sizeGb: 4,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/q4.gguf"
      },
      {
        id: "org/repo/q6.gguf",
        name: "q6",
        friendlyName: "q6",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 6 * 1024 ** 3,
        sizeGb: 6,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/q6.gguf"
      }
    ];

    const selected = selectBestModelForHardware(models, { vramGb: 5 });
    expect(selected?.id).toBe("org/repo/q4.gguf");
  });

  it("falls back to largest runnable model when none fit VRAM", () => {
    const models = [
      {
        id: "org/repo/a.gguf",
        name: "a",
        friendlyName: "a",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 6 * 1024 ** 3,
        sizeGb: 6,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/a.gguf"
      },
      {
        id: "org/repo/b.gguf",
        name: "b",
        friendlyName: "b",
        host: "org",
        backend: "llamacpp" as const,
        friendlyBackend: "llama.cpp" as const,
        sizeBytes: 8 * 1024 ** 3,
        sizeGb: 8,
        canRun: true,
        reason: "Fits RAM+VRAM",
        path: "/tmp/b.gguf"
      }
    ];

    const selected = selectBestModelForHardware(models, { vramGb: 4 });
    expect(selected?.id).toBe("org/repo/b.gguf");
  });
});
