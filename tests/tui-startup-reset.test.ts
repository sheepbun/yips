import { describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "../src/config";
import { ensureFreshLlamaSessionOnStartup } from "../src/tui";

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
