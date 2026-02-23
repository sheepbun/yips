import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDefaultConfig, loadConfig } from "../src/config";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "yips-config-test-"));
}

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
        backend: "claude"
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.source).toBe("file");
    expect(result.warning).toBeUndefined();
    expect(result.config).toEqual({
      streaming: false,
      verbose: true,
      backend: "claude"
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
        backend: "invalid-backend"
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.source).toBe("file");
    expect(result.config).toEqual({
      streaming: true,
      verbose: true,
      backend: "llamacpp"
    });
  });
});
