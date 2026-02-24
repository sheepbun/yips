import { describe, expect, it } from "vitest";

import { buildPromptStatusText, composeOutputLines } from "../src/tui";

describe("composeOutputLines", () => {
  it("appends transient busy line after output and autocomplete rows", () => {
    const lines = composeOutputLines({
      outputLines: ["out-1"],
      autocompleteOverlay: ["menu-1"],
      busyLine: "⠹ Thinking... (0s)"
    });

    expect(lines).toEqual(["out-1", "menu-1", "⠹ Thinking... (0s)"]);
  });

  it("omits busy line when not provided", () => {
    const lines = composeOutputLines({
      outputLines: ["out-1"],
      autocompleteOverlay: []
    });

    expect(lines).toEqual(["out-1"]);
  });
});

describe("buildPromptStatusText", () => {
  it("does not include busy label in prompt status text", () => {
    const status = buildPromptStatusText({
      uiMode: "chat",
      config: {
        backend: "llamacpp",
        model: "example/model.gguf",
        nicknames: {},
        llamaBaseUrl: "http://127.0.0.1:8080",
        llamaPath: "llama-server",
        llamaArgs: [],
        llamaModel: "default",
        llamaModelsDir: ".",
        startupTimeoutMs: 45_000,
        autoStartServer: true,
        stream: true,
        streaming: true,
        verbose: false,
        tokensMode: "auto",
        tokensManualMax: 8192
      },
      busy: true,
      busyLabel: "Thinking..."
    } as unknown as Parameters<typeof buildPromptStatusText>[0]);

    expect(status).toContain("llama.cpp");
    expect(status).not.toContain("Thinking...");
  });
});
