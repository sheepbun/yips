import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "#config/config";
import { startBackgroundGateway } from "#gateway/background";
import type { GatewayHeadlessHandler } from "#gateway/headless-conductor";
import type { GatewayCore } from "#gateway/core";
import type { Backend } from "#types/app-types";

const originalDiscordToken = process.env["YIPS_DISCORD_BOT_TOKEN"];
const originalTelegramToken = process.env["YIPS_TELEGRAM_BOT_TOKEN"];
const originalAllowedSenders = process.env["YIPS_GATEWAY_ALLOWED_SENDERS"];
const originalPassphrase = process.env["YIPS_GATEWAY_PASSPHRASE"];
const originalGatewayBackend = process.env["YIPS_GATEWAY_BACKEND"];

afterEach(() => {
  if (originalDiscordToken === undefined) {
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];
  } else {
    process.env["YIPS_DISCORD_BOT_TOKEN"] = originalDiscordToken;
  }
  if (originalTelegramToken === undefined) {
    delete process.env["YIPS_TELEGRAM_BOT_TOKEN"];
  } else {
    process.env["YIPS_TELEGRAM_BOT_TOKEN"] = originalTelegramToken;
  }
  if (originalAllowedSenders === undefined) {
    delete process.env["YIPS_GATEWAY_ALLOWED_SENDERS"];
  } else {
    process.env["YIPS_GATEWAY_ALLOWED_SENDERS"] = originalAllowedSenders;
  }
  if (originalPassphrase === undefined) {
    delete process.env["YIPS_GATEWAY_PASSPHRASE"];
  } else {
    process.env["YIPS_GATEWAY_PASSPHRASE"] = originalPassphrase;
  }
  if (originalGatewayBackend === undefined) {
    delete process.env["YIPS_GATEWAY_BACKEND"];
  } else {
    process.env["YIPS_GATEWAY_BACKEND"] = originalGatewayBackend;
  }
  vi.restoreAllMocks();
});

describe("startBackgroundGateway", () => {
  it("returns inactive handle when no Discord or Telegram token is configured", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "";
    config.channels.telegram.botToken = "";
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];
    delete process.env["YIPS_TELEGRAM_BOT_TOKEN"];

    const createHeadlessHandler = vi.fn();
    const handle = await startBackgroundGateway(
      { config },
      {
        createHeadlessHandler: createHeadlessHandler as never
      }
    );

    expect(handle.active).toBe(false);
    expect(createHeadlessHandler).not.toHaveBeenCalled();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it("starts Discord background runtime using config token when env is unset", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "config-token";
    config.channels.telegram.botToken = "";
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];

    const dispose = vi.fn();
    const createHeadlessHandler = vi.fn(
      async (): Promise<GatewayHeadlessHandler> => ({
        handleMessage: async () => ({ text: "ok" }),
        dispose
      })
    );
    const gateway = {} as GatewayCore;
    const createGatewayCore = vi.fn(() => gateway);
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const createDiscordRuntime = vi.fn(() => ({ start, stop }));
    const resolveBackend = vi.fn<(rawValue: string | undefined) => Backend>(() => "llamacpp");
    const info = vi.fn();
    const error = vi.fn();

    const handle = await startBackgroundGateway(
      {
        config,
        logger: { info, error }
      },
      {
        resolveBackend,
        createHeadlessHandler,
        createGatewayCore,
        createDiscordRuntime,
        createTelegramRuntime: vi.fn()
      }
    );

    expect(handle.active).toBe(true);
    expect(resolveBackend).toHaveBeenCalledWith(undefined);
    expect(createHeadlessHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        username: "Gateway User",
        gatewayBackend: "llamacpp"
      })
    );
    expect(createGatewayCore).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedSenderIds: undefined,
        passphrase: undefined
      })
    );
    expect(createDiscordRuntime).toHaveBeenCalledWith({
      botToken: "config-token",
      gateway
    });
    expect(start).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("[gateway] Discord runtime started in background.");

    await handle.stop();
    await handle.stop();

    expect(stop).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("prefers env Discord token and forwards auth config to gateway core", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "config-token";
    config.channels.telegram.botToken = "";
    process.env["YIPS_DISCORD_BOT_TOKEN"] = "env-token";
    process.env["YIPS_GATEWAY_ALLOWED_SENDERS"] = " user1, user2 ,,";
    process.env["YIPS_GATEWAY_PASSPHRASE"] = " secret ";

    const createHeadlessHandler = vi.fn(
      async (): Promise<GatewayHeadlessHandler> => ({
        handleMessage: async () => ({ text: "ok" }),
        dispose: vi.fn()
      })
    );
    const gateway = {} as GatewayCore;
    const createGatewayCore = vi.fn(() => gateway);
    const createDiscordRuntime = vi.fn(() => ({
      start: async () => undefined,
      stop: async () => undefined
    }));

    const handle = await startBackgroundGateway(
      { config },
      {
        resolveBackend: () => "llamacpp",
        createHeadlessHandler,
        createGatewayCore,
        createDiscordRuntime,
        createTelegramRuntime: vi.fn()
      }
    );

    expect(createDiscordRuntime).toHaveBeenCalledWith({
      botToken: "env-token",
      gateway
    });
    expect(createGatewayCore).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedSenderIds: ["user1", "user2"],
        passphrase: "secret"
      })
    );

    await handle.stop();
  });

  it("disposes headless handler when runtime start fails", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "config-token";
    config.channels.telegram.botToken = "";

    const dispose = vi.fn();
    const createHeadlessHandler = vi.fn(
      async (): Promise<GatewayHeadlessHandler> => ({
        handleMessage: async () => ({ text: "ok" }),
        dispose
      })
    );
    const createDiscordRuntime = vi.fn(() => ({
      start: async () => {
        throw new Error("boom");
      },
      stop: async () => undefined
    }));

    await expect(
      startBackgroundGateway(
        { config },
        {
          resolveBackend: () => "llamacpp",
          createHeadlessHandler,
          createGatewayCore: () => ({}) as GatewayCore,
          createDiscordRuntime,
          createTelegramRuntime: vi.fn()
        }
      )
    ).rejects.toThrow("boom");

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("starts Telegram background runtime when Telegram token is configured", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "";
    config.channels.telegram.botToken = "tg-config-token";
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];
    delete process.env["YIPS_TELEGRAM_BOT_TOKEN"];

    const dispose = vi.fn();
    const createHeadlessHandler = vi.fn(
      async (): Promise<GatewayHeadlessHandler> => ({
        handleMessage: async () => ({ text: "ok" }),
        dispose
      })
    );
    const gateway = {} as GatewayCore;
    const createGatewayCore = vi.fn(() => gateway);
    const createDiscordRuntime = vi.fn();
    const tgStart = vi.fn(async () => undefined);
    const tgStop = vi.fn(async () => undefined);
    const createTelegramRuntime = vi.fn(() => ({ start: tgStart, stop: tgStop }));

    const handle = await startBackgroundGateway(
      { config },
      {
        resolveBackend: () => "llamacpp",
        createHeadlessHandler,
        createGatewayCore,
        createDiscordRuntime,
        createTelegramRuntime
      }
    );

    expect(handle.active).toBe(true);
    expect(createDiscordRuntime).not.toHaveBeenCalled();
    expect(createTelegramRuntime).toHaveBeenCalledWith({
      botToken: "tg-config-token",
      gateway
    });
    expect(tgStart).toHaveBeenCalledOnce();

    await handle.stop();
    expect(tgStop).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("starts both runtimes when both tokens are configured", async () => {
    const config = getDefaultConfig();
    config.channels.discord.botToken = "dc-config-token";
    config.channels.telegram.botToken = "tg-config-token";
    delete process.env["YIPS_DISCORD_BOT_TOKEN"];
    delete process.env["YIPS_TELEGRAM_BOT_TOKEN"];

    const dispose = vi.fn();
    const createHeadlessHandler = vi.fn(
      async (): Promise<GatewayHeadlessHandler> => ({
        handleMessage: async () => ({ text: "ok" }),
        dispose
      })
    );
    const gateway = {} as GatewayCore;
    const createGatewayCore = vi.fn(() => gateway);
    const dcStart = vi.fn(async () => undefined);
    const dcStop = vi.fn(async () => undefined);
    const tgStart = vi.fn(async () => undefined);
    const tgStop = vi.fn(async () => undefined);
    const createDiscordRuntime = vi.fn(() => ({ start: dcStart, stop: dcStop }));
    const createTelegramRuntime = vi.fn(() => ({ start: tgStart, stop: tgStop }));

    const handle = await startBackgroundGateway(
      { config },
      {
        resolveBackend: () => "llamacpp",
        createHeadlessHandler,
        createGatewayCore,
        createDiscordRuntime,
        createTelegramRuntime
      }
    );

    expect(handle.active).toBe(true);
    expect(createDiscordRuntime).toHaveBeenCalledOnce();
    expect(createTelegramRuntime).toHaveBeenCalledOnce();
    expect(dcStart).toHaveBeenCalledOnce();
    expect(tgStart).toHaveBeenCalledOnce();

    await handle.stop();
    expect(dcStop).toHaveBeenCalledOnce();
    expect(tgStop).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
