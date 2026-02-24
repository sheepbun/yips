import { describe, expect, it } from "vitest";

import {
  createModelManagerState,
  getSelectedModel,
  moveModelManagerSelection,
  removeModelById,
  setModelManagerError,
  setModelManagerLoading,
  setModelManagerModels,
  setModelManagerSearchQuery
} from "../src/model-manager-state";

const baseModels = [
  {
    id: "org/a/model-a.gguf",
    name: "model-a",
    friendlyName: "alpha",
    host: "org",
    backend: "llamacpp" as const,
    friendlyBackend: "llama.cpp" as const,
    sizeBytes: 1,
    sizeGb: 0,
    canRun: true,
    reason: "Fits RAM+VRAM",
    path: "/tmp/model-a.gguf"
  },
  {
    id: "org/b/model-b.gguf",
    name: "model-b",
    friendlyName: "beta",
    host: "org",
    backend: "llamacpp" as const,
    friendlyBackend: "llama.cpp" as const,
    sizeBytes: 1,
    sizeGb: 0,
    canRun: true,
    reason: "Fits RAM+VRAM",
    path: "/tmp/model-b.gguf"
  }
];

describe("model-manager-state", () => {
  it("sets loading and error phases", () => {
    const base = createModelManagerState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 });
    const loading = setModelManagerLoading(base, "Loading");
    expect(loading.phase).toBe("loading");

    const error = setModelManagerError(loading, "Oops");
    expect(error.phase).toBe("error");
    expect(error.errorMessage).toBe("Oops");
  });

  it("loads models and filters by search query", () => {
    const base = createModelManagerState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 });
    const withModels = setModelManagerModels(base, baseModels);
    expect(withModels.models).toHaveLength(2);

    const filtered = setModelManagerSearchQuery(withModels, "beta");
    expect(filtered.models).toHaveLength(1);
    expect(filtered.models[0]?.id).toBe("org/b/model-b.gguf");
  });

  it("moves selection and keeps scroll within range", () => {
    const base = setModelManagerModels(
      createModelManagerState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }),
      baseModels
    );

    const moved = moveModelManagerSelection(base, 1, 1);
    expect(moved.selectedModelIndex).toBe(1);
    expect(moved.scrollOffset).toBe(1);
    expect(getSelectedModel(moved)?.id).toBe("org/b/model-b.gguf");
  });

  it("removes model by id", () => {
    const base = setModelManagerModels(
      createModelManagerState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }),
      baseModels
    );

    const next = removeModelById(base, "org/a/model-a.gguf");
    expect(next.models).toHaveLength(1);
    expect(next.models[0]?.id).toBe("org/b/model-b.gguf");
  });
});
