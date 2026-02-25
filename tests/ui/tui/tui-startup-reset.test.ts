import { describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "#config/config";
import {
  applyHardwareAwareStartupModelSelection,
  ensureFreshLlamaSessionOnStartup,
  runOnceGuarded
} from "#ui/tui/start-tui";

describe("ensureFreshLlamaSessionOnStartup", () => {
  it("skips reset when no concrete model is selected", async () => {
    const reset = vi.fn();
    const config = { ...getDefaultConfig(), model: "default" };

    await ensureFreshLlamaSessionOnStartup({ config }, { reset });

    expect(reset).not.toHaveBeenCalled();
  });

  it("skips reset for non-llama backends", async () => {
    const reset = vi.fn();
    const config = { ...getDefaultConfig(), backend: "claude" as const };

    await ensureFreshLlamaSessionOnStartup({ config }, { reset });

    expect(reset).not.toHaveBeenCalled();
  });

  it("runs reset for llama backend", async () => {
    const reset = vi.fn().mockResolvedValue({ started: true });
    const config = { ...getDefaultConfig(), model: "qwen.gguf" };

    await ensureFreshLlamaSessionOnStartup({ config }, { reset });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(config);
  });

  it("throws startup failure when reset fails", async () => {
    const reset = vi.fn().mockResolvedValue({
      started: false,
      failure: {
        kind: "model-not-found",
        message: "Could not resolve model.",
        details: ["Checked models dir: /tmp/models"]
      }
    });

    const config = {
      ...getDefaultConfig(),
      model: "missing.gguf",
      llamaModelsDir: "/tmp/models"
    };

    await expect(ensureFreshLlamaSessionOnStartup({ config }, { reset })).rejects.toThrow(
      "Could not resolve model."
    );
  });
});

describe("applyHardwareAwareStartupModelSelection", () => {
  it("auto-selects and saves a runnable model when current config is default", async () => {
    const config = { ...getDefaultConfig(), model: "default", backend: "llamacpp" as const };
    const save = vi.fn().mockResolvedValue(undefined);

    const selected = await applyHardwareAwareStartupModelSelection(
      { config },
      {
        getSpecs: vi.fn().mockReturnValue({
          ramGb: 32,
          vramGb: 8,
          totalMemoryGb: 40,
          diskFreeGb: 100,
          gpuType: "nvidia"
        }),
        listModels: vi.fn().mockResolvedValue([
          {
            id: "org/repo/model-q4.gguf",
            name: "model-q4",
            friendlyName: "model-q4",
            host: "org",
            backend: "llamacpp",
            friendlyBackend: "llama.cpp",
            sizeBytes: 4 * 1024 ** 3,
            sizeGb: 4,
            canRun: true,
            reason: "Fits RAM+VRAM",
            path: "/tmp/model-q4.gguf"
          }
        ]),
        selectModel: vi.fn().mockReturnValue({
          id: "org/repo/model-q4.gguf"
        }),
        save
      }
    );

    expect(selected).toBe("org/repo/model-q4.gguf");
    expect(config.model).toBe("org/repo/model-q4.gguf");
    expect(save).toHaveBeenCalledWith(config);
  });

  it("skips auto-selection when a concrete model is already configured", async () => {
    const config = { ...getDefaultConfig(), model: "org/repo/existing.gguf" };
    const listModels = vi.fn();

    const selected = await applyHardwareAwareStartupModelSelection(
      { config },
      {
        getSpecs: vi.fn(),
        listModels,
        selectModel: vi.fn(),
        save: vi.fn()
      }
    );

    expect(selected).toBeNull();
    expect(listModels).not.toHaveBeenCalled();
  });
});

describe("runOnceGuarded", () => {
  it("runs operation only on first call", async () => {
    const guard = { current: false };
    const operation = vi.fn().mockResolvedValue(undefined);

    const first = await runOnceGuarded(guard, operation);
    const second = await runOnceGuarded(guard, operation);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
