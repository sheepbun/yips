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
      streaming: false,
      verbose: true,
      backend: "claude",
      llamaBaseUrl: "http://localhost:9000",
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
      streaming: true,
      verbose: true,
      backend: "llamacpp",
      llamaBaseUrl: "http://127.0.0.1:8080",
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
