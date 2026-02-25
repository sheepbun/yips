import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDefaultConfig, loadConfig, saveConfig, updateConfig } from "#config/config";

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
const originalWhatsappBotToken = process.env["YIPS_WHATSAPP_BOT_TOKEN"];
const originalTelegramBotToken = process.env["YIPS_TELEGRAM_BOT_TOKEN"];
const originalDiscordBotToken = process.env["YIPS_DISCORD_BOT_TOKEN"];
const originalConfigPath = process.env["YIPS_CONFIG_PATH"];

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

  if (originalWhatsappBotToken === undefined) {
    delete process.env["YIPS_WHATSAPP_BOT_TOKEN"];
  } else {
    process.env["YIPS_WHATSAPP_BOT_TOKEN"] = originalWhatsappBotToken;
  }

  if (originalTelegramBotToken === undefined) {
    delete process.env["YIPS_TELEGRAM_BOT_TOKEN"];
  } else {
    process.env["YIPS_TELEGRAM_BOT_TOKEN"] = originalTelegramBotToken;
  }

  if (originalDiscordBotToken === undefined) {
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];
  } else {
    process.env["YIPS_DISCORD_BOT_TOKEN"] = originalDiscordBotToken;
  }

  if (originalConfigPath === undefined) {
    delete process.env["YIPS_CONFIG_PATH"];
  } else {
    process.env["YIPS_CONFIG_PATH"] = originalConfigPath;
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
      nicknames: {},
      hooks: {}
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
      nicknames: {},
      hooks: {}
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
    process.env["YIPS_WHATSAPP_BOT_TOKEN"] = "wa-env-token";
    process.env["YIPS_TELEGRAM_BOT_TOKEN"] = "tg-env-token";
    process.env["YIPS_DISCORD_BOT_TOKEN"] = "dc-env-token";

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
    expect(result.config.channels.whatsapp.botToken).toBe("wa-env-token");
    expect(result.config.channels.telegram.botToken).toBe("tg-env-token");
    expect(result.config.channels.discord.botToken).toBe("dc-env-token");
  });

  it("normalizes channels from file config", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "channels-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        channels: {
          whatsapp: { botToken: "  wa-file  " },
          telegram: { botToken: "tg-file" },
          discord: { botToken: "" }
        }
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.config.channels.whatsapp.botToken).toBe("wa-file");
    expect(result.config.channels.telegram.botToken).toBe("tg-file");
    expect(result.config.channels.discord.botToken).toBe("");
  });

  it("normalizes hooks config entries and timeout bounds", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "hooks-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        hooks: {
          "on-session-start": {
            command: "echo start",
            timeoutMs: 5000
          },
          "on-file-write": {
            command: "echo file"
          },
          "on-session-end": {
            command: "echo end",
            timeoutMs: 999_999
          },
          "not-a-hook": {
            command: "echo invalid"
          },
          "pre-commit": {
            command: "   "
          }
        }
      }),
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.config.hooks["on-session-start"]).toEqual({
      command: "echo start",
      timeoutMs: 5000
    });
    expect(result.config.hooks["on-file-write"]).toEqual({
      command: "echo file",
      timeoutMs: 10000
    });
    expect(result.config.hooks["on-session-end"]).toEqual({
      command: "echo end",
      timeoutMs: 120000
    });
    expect(result.config.hooks["pre-commit"]).toBeUndefined();
    expect((result.config.hooks as Record<string, unknown>)["not-a-hook"]).toBeUndefined();
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

  it("uses YIPS_CONFIG_PATH for default config location", async () => {
    const dir = await createTempDir();
    const envConfigPath = join(dir, "env-config.json");
    process.env["YIPS_CONFIG_PATH"] = envConfigPath;

    await saveConfig({
      ...getDefaultConfig(),
      model: "env-model",
      nicknames: { "env-model": "env-nick" }
    });

    const loaded = await loadConfig();
    expect(loaded.path).toBe(envConfigPath);
    expect(loaded.config.model).toBe("env-model");
    expect(loaded.config.nicknames["env-model"]).toBe("env-nick");
  });

  it("falls back to legacy .yips_config.json when YIPS_CONFIG_PATH is missing", async () => {
    const dir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      process.env["YIPS_CONFIG_PATH"] = join(dir, "missing-env-config.json");
      const legacyConfigPath = join(dir, ".yips_config.json");
      await writeFile(
        legacyConfigPath,
        JSON.stringify({
          model: "legacy-model",
          nicknames: { "legacy-model": "legacy-nick" }
        }),
        "utf8"
      );

      const loaded = await loadConfig();
      expect(loaded.path).toBe(legacyConfigPath);
      expect(loaded.config.model).toBe("legacy-model");
      expect(loaded.config.nicknames["legacy-model"]).toBe("legacy-nick");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
