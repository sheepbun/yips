import { describe, expect, it } from "vitest";

import { stripAnsi } from "../src/colors";
import { renderModelManagerLines } from "../src/model-manager-ui";
import type { ModelManagerState } from "../src/model-manager-state";

function makeState(overrides?: Partial<ModelManagerState>): ModelManagerState {
  return {
    isOpen: true,
    searchQuery: "",
    allModels: [],
    models: [],
    selectedModelIndex: 0,
    scrollOffset: 0,
    phase: "idle",
    loading: false,
    loadingMessage: "Loading models...",
    errorMessage: "",
    ramGb: 16,
    vramGb: 8,
    totalMemoryGb: 24,
    ...overrides
  };
}

describe("model-manager-ui", () => {
  it("renders bordered frame and footer", () => {
    const lines = renderModelManagerLines({
      width: 90,
      currentModel: "default",
      state: makeState()
    });
    const plain = lines.map((line) => stripAnsi(line));

    expect(plain[0]).toContain("Yips Model Manager");
    expect(plain.at(-1)).toContain("╯");
    expect(plain.join("\n")).toContain("[Del] Delete Local");
  });

  it("renders loading and error rows", () => {
    const loadingLines = renderModelManagerLines({
      width: 80,
      currentModel: "default",
      state: makeState({
        phase: "loading",
        loading: true,
        loadingMessage: "Loading local models..."
      })
    });
    expect(stripAnsi(loadingLines.join("\n"))).toContain("Loading: Loading local models...");

    const errorLines = renderModelManagerLines({
      width: 80,
      currentModel: "default",
      state: makeState({ phase: "error", errorMessage: "failed" })
    });
    expect(stripAnsi(errorLines.join("\n"))).toContain("Error: failed");
  });

  it("marks current model row", () => {
    const state = makeState({
      allModels: [
        {
          id: "org/repo/model.gguf",
          name: "model",
          friendlyName: "model",
          host: "org",
          backend: "llamacpp",
          friendlyBackend: "llama.cpp",
          sizeBytes: 10,
          sizeGb: 0,
          canRun: true,
          reason: "Fits RAM+VRAM",
          path: "/tmp/model.gguf"
        }
      ],
      models: [
        {
          id: "org/repo/model.gguf",
          name: "model",
          friendlyName: "model",
          host: "org",
          backend: "llamacpp",
          friendlyBackend: "llama.cpp",
          sizeBytes: 10,
          sizeGb: 0,
          canRun: true,
          reason: "Fits RAM+VRAM",
          path: "/tmp/model.gguf"
        }
      ]
    });

    const lines = renderModelManagerLines({
      width: 110,
      currentModel: "org/repo/model.gguf",
      state
    });

    expect(stripAnsi(lines.join("\n"))).toContain(">* org");
  });
});
