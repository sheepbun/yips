import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDefaultConfig, loadConfig, saveConfig, updateConfig } from "../src/config";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "yips-config-test-"));
}

const originalLlamaBaseUrl = process.env["YIPS_LLAMA_BASE_URL"];
const originalModel = process.env["YIPS_MODEL"];
const originalLlamaHost = process.env["YIPS_LLAMA_HOST"];
const originalLlamaPort = process.env["YIPS_LLAMA_PORT"];
const originalLlamaServerPath = process.env["YIPS_LLAMA_SERVER_PATH"];
const originalLlamaModelsDir = process.env["YIPS_LLAMA_MODELS_DIR"];
const originalLlamaContextSize = process.env["YIPS_LLAMA_CONTEXT_SIZE"];
const originalLlamaGpuLayers = process.env["YIPS_LLAMA_GPU_LAYERS"];
const originalLlamaAutoStart = process.env["YIPS_LLAMA_AUTO_START"];
const originalLlamaPortConflictPolicy = process.env["YIPS_LLAMA_PORT_CONFLICT_POLICY"];
const originalTokensMode = process.env["YIPS_TOKENS_MODE"];
const originalTokensManualMax = process.env["YIPS_TOKENS_MANUAL_MAX"];

afterEach(() => {
  if (originalLlamaBaseUrl === undefined) {
    delete process.env["YIPS_LLAMA_BASE_URL"];
  } else {
    process.env["YIPS_LLAMA_BASE_URL"] = originalLlamaBaseUrl;
  }

  if (originalModel === undefined) {
    delete process.env["YIPS_MODEL"];
  } else {
    process.env["YIPS_MODEL"] = originalModel;
  }

  if (originalLlamaHost === undefined) {
    delete process.env["YIPS_LLAMA_HOST"];
  } else {
    process.env["YIPS_LLAMA_HOST"] = originalLlamaHost;
  }

  if (originalLlamaPort === undefined) {
    delete process.env["YIPS_LLAMA_PORT"];
  } else {
    process.env["YIPS_LLAMA_PORT"] = originalLlamaPort;
  }

  if (originalLlamaServerPath === undefined) {
    delete process.env["YIPS_LLAMA_SERVER_PATH"];
  } else {
    process.env["YIPS_LLAMA_SERVER_PATH"] = originalLlamaServerPath;
  }

  if (originalLlamaModelsDir === undefined) {
    delete process.env["YIPS_LLAMA_MODELS_DIR"];
  } else {
    process.env["YIPS_LLAMA_MODELS_DIR"] = originalLlamaModelsDir;
  }

  if (originalLlamaContextSize === undefined) {
    delete process.env["YIPS_LLAMA_CONTEXT_SIZE"];
  } else {
    process.env["YIPS_LLAMA_CONTEXT_SIZE"] = originalLlamaContextSize;
  }

  if (originalLlamaGpuLayers === undefined) {
    delete process.env["YIPS_LLAMA_GPU_LAYERS"];
  } else {
    process.env["YIPS_LLAMA_GPU_LAYERS"] = originalLlamaGpuLayers;
  }

  if (originalLlamaAutoStart === undefined) {
    delete process.env["YIPS_LLAMA_AUTO_START"];
  } else {
    process.env["YIPS_LLAMA_AUTO_START"] = originalLlamaAutoStart;
  }

  if (originalLlamaPortConflictPolicy === undefined) {
    delete process.env["YIPS_LLAMA_PORT_CONFLICT_POLICY"];
  } else {
    process.env["YIPS_LLAMA_PORT_CONFLICT_POLICY"] = originalLlamaPortConflictPolicy;
  }

  if (originalTokensMode === undefined) {
    delete process.env["YIPS_TOKENS_MODE"];
  } else {
    process.env["YIPS_TOKENS_MODE"] = originalTokensMode;
  }

  if (originalTokensManualMax === undefined) {
    delete process.env["YIPS_TOKENS_MANUAL_MAX"];
  } else {
    process.env["YIPS_TOKENS_MANUAL_MAX"] = originalTokensManualMax;
  }
});

describe("loadConfig", () => {
  it("returns defaults when config file is missing", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "missing-config.json");

    const result = await loadConfig(configPath);

    expect(result.source).toBe("default");
    expect(result.warning).toBeUndefined();
    expect(result.config).toEqual(getDefaultConfig());
  });

  it("returns defaults with warning when config JSON is malformed", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "bad-config.json");
    await writeFile(configPath, "{ malformed", "utf8");

    const result = await loadConfig(configPath);

    expect(result.source).toBe("default");
    expect(result.warning).toContain("Failed to load config");
    expect(result.config).toEqual(getDefaultConfig());
  });

  it("merges valid config values over defaults", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "good-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        streaming: false,
        verbose: true,
        backend: "claude",
        llamaBaseUrl: "http://localhost:9000",
        model: "qwen3"
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.source).toBe("file");
    expect(result.warning).toBeUndefined();
    expect(result.config).toEqual({
      ...getDefaultConfig(),
      streaming: false,
      verbose: true,
      backend: "claude",
      llamaBaseUrl: "http://localhost:9000",
      llamaHost: "localhost",
      llamaPort: 9000,
      model: "qwen3",
      nicknames: {}
    });
  });

  it("ignores invalid values and keeps defaults for unsupported keys", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "mixed-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        streaming: "yes",
        verbose: true,
        backend: "invalid-backend",
        llamaBaseUrl: "not-a-url",
        model: "   "
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.source).toBe("file");
    expect(result.config).toEqual({
      ...getDefaultConfig(),
      streaming: true,
      verbose: true,
      backend: "llamacpp",
      llamaBaseUrl: "http://127.0.0.1:8080",
      llamaHost: "127.0.0.1",
      llamaPort: 8080,
      model: "default",
      nicknames: {}
    });
  });

  it("applies environment overrides for model and base URL", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "env-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        model: "file-model",
        llamaBaseUrl: "http://127.0.0.1:9999"
      }),
      "utf8"
    );

    process.env["YIPS_MODEL"] = "env-model";
    process.env["YIPS_LLAMA_BASE_URL"] = "http://localhost:8888/";

    const result = await loadConfig(configPath);

    expect(result.config.model).toBe("env-model");
    expect(result.config.llamaBaseUrl).toBe("http://localhost:8888");
    expect(result.config.llamaHost).toBe("localhost");
    expect(result.config.llamaPort).toBe(8888);
  });

  it("applies environment overrides for lifecycle fields", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "lifecycle-config.json");

    process.env["YIPS_LLAMA_HOST"] = "0.0.0.0";
    process.env["YIPS_LLAMA_PORT"] = "18080";
    process.env["YIPS_LLAMA_SERVER_PATH"] = "/tmp/llama-server";
    process.env["YIPS_LLAMA_MODELS_DIR"] = "/tmp/models";
    process.env["YIPS_LLAMA_CONTEXT_SIZE"] = "4096";
    process.env["YIPS_LLAMA_GPU_LAYERS"] = "77";
    process.env["YIPS_LLAMA_AUTO_START"] = "false";
    process.env["YIPS_LLAMA_PORT_CONFLICT_POLICY"] = "fail";
    process.env["YIPS_TOKENS_MODE"] = "manual";
    process.env["YIPS_TOKENS_MANUAL_MAX"] = "32000";

    const result = await loadConfig(configPath);

    expect(result.config.llamaHost).toBe("0.0.0.0");
    expect(result.config.llamaPort).toBe(18080);
    expect(result.config.llamaBaseUrl).toBe("http://0.0.0.0:18080");
    expect(result.config.llamaServerPath).toBe("/tmp/llama-server");
    expect(result.config.llamaModelsDir).toBe("/tmp/models");
    expect(result.config.llamaContextSize).toBe(4096);
    expect(result.config.llamaGpuLayers).toBe(77);
    expect(result.config.llamaAutoStart).toBe(false);
    expect(result.config.llamaPortConflictPolicy).toBe("fail");
    expect(result.config.tokensMode).toBe("manual");
    expect(result.config.tokensManualMax).toBe(32000);
  });

  it("persists config with saveConfig and updates with updateConfig", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "persist-config.json");

    await saveConfig(
      {
        ...getDefaultConfig(),
        model: "qwen3",
        nicknames: { qwen3: "q3" }
      },
      configPath
    );

    const updated = await updateConfig({ backend: "claude" }, configPath);
    expect(updated.backend).toBe("claude");
    expect(updated.model).toBe("qwen3");
    expect(updated.nicknames).toEqual({ qwen3: "q3" });
  });
});
