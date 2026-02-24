import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "../src/config";
import { ensureLlamaReady, formatLlamaStartupFailure, startLlamaServer } from "../src/llama-server";
import type { AppConfig } from "../src/types";

function withConfig(patch: Partial<AppConfig>): AppConfig {
  return { ...getDefaultConfig(), ...patch };
}

const originalPath = process.env["PATH"];
const originalHome = process.env["HOME"];
const originalLlamaServerPath = process.env["LLAMA_SERVER_PATH"];

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
  if (originalLlamaServerPath === undefined) {
    delete process.env["LLAMA_SERVER_PATH"];
  } else {
    process.env["LLAMA_SERVER_PATH"] = originalLlamaServerPath;
  }
});

describe("ensureLlamaReady", () => {
  it("reports ready when /health returns success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200, statusText: "OK" }))
    );
    const result = await ensureLlamaReady(withConfig({ model: "default" }));
    expect(result.ready).toBe(true);
    expect(result.started).toBe(false);
  });

  it("returns actionable failure when auto-start is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await ensureLlamaReady(withConfig({ model: "qwen.gguf", llamaAutoStart: false }));
    expect(result.ready).toBe(false);
    expect(result.failure?.message).toContain("auto-start is disabled");
  });
});

describe("startLlamaServer", () => {
  it("returns binary-not-found when llama-server cannot be resolved", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "yips-llama-home-"));
    process.env["HOME"] = fakeHome;
    process.env["PATH"] = "";
    process.env["LLAMA_SERVER_PATH"] = join(fakeHome, "missing-llama-server");

    const result = await startLlamaServer(
      withConfig({
        model: "qwen.gguf",
        llamaServerPath: join(fakeHome, "also-missing")
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("binary-not-found");
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("returns model-not-found when binary exists but model is unresolved", async () => {
    const result = await startLlamaServer(
      withConfig({
        model: "missing.gguf",
        llamaServerPath: "/bin/true",
        llamaModelsDir: "/tmp/yips-not-real-model-dir"
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("model-not-found");
  });

  it("returns process-exited when spawned binary exits immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true"
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("process-exited");
    await rm(root, { recursive: true, force: true });
  });
});

describe("formatLlamaStartupFailure", () => {
  it("includes commands and context lines", () => {
    const formatted = formatLlamaStartupFailure(
      {
        kind: "model-not-found",
        message: "Could not resolve model.",
        details: ["Checked: /tmp/models"]
      },
      withConfig({
        model: "qwen.gguf",
        llamaModelsDir: "/tmp/models"
      })
    );

    expect(formatted).toContain("Could not resolve model.");
    expect(formatted).toContain("which llama-server");
    expect(formatted).toContain("ls /tmp/models/qwen.gguf");
  });
});
