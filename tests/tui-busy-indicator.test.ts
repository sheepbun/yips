import { describe, expect, it } from "vitest";

import {
  buildPromptStatusText,
  computeTokensPerSecond,
  composeOutputLines,
  formatModelLoadingLabel,
  formatTokensPerSecond
} from "../src/tui";

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
      busyLabel: "Thinking...",
      latestOutputTokensPerSecond: null
    } as unknown as Parameters<typeof buildPromptStatusText>[0]);

    expect(status).toContain("llama.cpp");
    expect(status).not.toContain("Thinking...");
    expect(status).toContain(" · ");
  });

  it("includes latest output throughput when available", () => {
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
      latestOutputTokensPerSecond: 37.26
    } as unknown as Parameters<typeof buildPromptStatusText>[0]);

    expect(status).toContain("llama.cpp · example · 37.3 tk/s");
  });

  it("keeps provider-only status when model is unresolved", () => {
    const status = buildPromptStatusText({
      uiMode: "chat",
      config: {
        backend: "llamacpp",
        model: "default",
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
      latestOutputTokensPerSecond: 50
    } as unknown as Parameters<typeof buildPromptStatusText>[0]);

    expect(status).toBe("llama.cpp");
  });
});

describe("throughput helpers", () => {
  it("computes tokens-per-second from token count and duration", () => {
    expect(computeTokensPerSecond(250, 5000)).toBe(50);
  });

  it("returns null for invalid inputs", () => {
    expect(computeTokensPerSecond(0, 5000)).toBeNull();
    expect(computeTokensPerSecond(100, 0)).toBeNull();
  });

  it("formats tokens-per-second with one decimal place", () => {
    expect(formatTokensPerSecond(37.26)).toBe("37.3 tk/s");
  });
});

describe("model preload label", () => {
  it("formats GPU loading label with friendly model name", () => {
    const label = formatModelLoadingLabel(
      {
        backend: "llamacpp",
        model: "org/repo/model.gguf",
        nicknames: {},
        llamaBaseUrl: "http://127.0.0.1:8080",
        llamaServerPath: "",
        llamaModelsDir: ".",
        llamaHost: "127.0.0.1",
        llamaPort: 8080,
        llamaContextSize: 8192,
        llamaGpuLayers: 999,
        llamaAutoStart: true,
        llamaPortConflictPolicy: "kill-user",
        streaming: true,
        verbose: false,
        tokensMode: "auto",
        tokensManualMax: 8192
      },
      {}
    );

    expect(label).toBe("Loading repo into GPU...");
  });

  it("formats CPU loading label when gpu layers are disabled", () => {
    const label = formatModelLoadingLabel(
      {
        backend: "llamacpp",
        model: "org/repo/model.gguf",
        nicknames: {},
        llamaBaseUrl: "http://127.0.0.1:8080",
        llamaServerPath: "",
        llamaModelsDir: ".",
        llamaHost: "127.0.0.1",
        llamaPort: 8080,
        llamaContextSize: 8192,
        llamaGpuLayers: 0,
        llamaAutoStart: true,
        llamaPortConflictPolicy: "kill-user",
        streaming: true,
        verbose: false,
        tokensMode: "auto",
        tokensManualMax: 8192
      },
      {}
    );

    expect(label).toBe("Loading repo into CPU...");
  });
});
