import type { AppConfig, Backend } from "#types/app-types";
import { GatewayCore } from "#gateway/core";
import { createGatewayHeadlessMessageHandler } from "#gateway/headless-conductor";
import { createDiscordGatewayRuntime } from "#gateway/runtime/discord-bot";
import { createTelegramGatewayRuntime } from "#gateway/runtime/telegram-bot";
import { resolveGatewayBackendFromEnv } from "#gateway/runtime/backend-policy";

interface BackgroundLogger {
  error: (message?: unknown, ...optionalParams: unknown[]) => void;
  info: (message?: unknown, ...optionalParams: unknown[]) => void;
}

interface DiscordRuntime {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface TelegramRuntime {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface BackgroundGatewayDeps {
  resolveBackend: (rawValue: string | undefined) => Backend;
  createHeadlessHandler: typeof createGatewayHeadlessMessageHandler;
  createGatewayCore: (options: ConstructorParameters<typeof GatewayCore>[0]) => GatewayCore;
  createDiscordRuntime: (options: {
    botToken: string;
    gateway: GatewayCore;
  }) => DiscordRuntime;
  createTelegramRuntime: (options: {
    botToken: string;
    gateway: GatewayCore;
  }) => TelegramRuntime;
}

const DEFAULT_DEPS: BackgroundGatewayDeps = {
  resolveBackend: resolveGatewayBackendFromEnv,
  createHeadlessHandler: createGatewayHeadlessMessageHandler,
  createGatewayCore: (options): GatewayCore => new GatewayCore(options),
  createDiscordRuntime: (options): DiscordRuntime => createDiscordGatewayRuntime(options),
  createTelegramRuntime: (options): TelegramRuntime => createTelegramGatewayRuntime(options)
};

export interface BackgroundGatewayHandle {
  readonly active: boolean;
  stop: () => Promise<void>;
}

export interface StartBackgroundGatewayOptions {
  config: AppConfig;
  logger?: BackgroundLogger;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readAllowedSenders(): string[] {
  const raw = process.env.YIPS_GATEWAY_ALLOWED_SENDERS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveDiscordToken(config: AppConfig): string {
  const envToken = readOptionalEnv("YIPS_DISCORD_BOT_TOKEN");
  if (envToken) {
    return envToken;
  }
  return config.channels.discord.botToken.trim();
}

function resolveTelegramToken(config: AppConfig): string {
  const envToken = readOptionalEnv("YIPS_TELEGRAM_BOT_TOKEN");
  if (envToken) {
    return envToken;
  }
  return config.channels.telegram.botToken.trim();
}

export async function startBackgroundGateway(
  options: StartBackgroundGatewayOptions,
  deps: Partial<BackgroundGatewayDeps> = {}
): Promise<BackgroundGatewayHandle> {
  const logger = options.logger;
  const discordToken = resolveDiscordToken(options.config);
  const telegramToken = resolveTelegramToken(options.config);

  if (discordToken.length === 0 && telegramToken.length === 0) {
    return {
      active: false,
      stop: async (): Promise<void> => {}
    };
  }

  const mergedDeps = { ...DEFAULT_DEPS, ...deps };
  const allowedSenderIds = readAllowedSenders();
  const passphrase = readOptionalEnv("YIPS_GATEWAY_PASSPHRASE");
  const gatewayBackend = mergedDeps.resolveBackend(process.env.YIPS_GATEWAY_BACKEND);
  const headless = await mergedDeps.createHeadlessHandler({
    config: options.config,
    username: "Gateway User",
    gatewayBackend
  });
  const gateway = mergedDeps.createGatewayCore({
    allowedSenderIds: allowedSenderIds.length > 0 ? allowedSenderIds : undefined,
    passphrase,
    handleMessage: headless.handleMessage
  });
  const runtimes: Array<{ name: "discord" | "telegram"; stop: () => Promise<void> }> = [];
  try {
    if (discordToken.length > 0) {
      const discordRuntime = mergedDeps.createDiscordRuntime({
        botToken: discordToken,
        gateway
      });
      await discordRuntime.start();
      runtimes.push({ name: "discord", stop: () => discordRuntime.stop() });
      logger?.info("[gateway] Discord runtime started in background.");
    }

    if (telegramToken.length > 0) {
      const telegramRuntime = mergedDeps.createTelegramRuntime({
        botToken: telegramToken,
        gateway
      });
      await telegramRuntime.start();
      runtimes.push({ name: "telegram", stop: () => telegramRuntime.stop() });
      logger?.info("[gateway] Telegram runtime started in background.");
    }
  } catch (error) {
    for (const runtime of [...runtimes].reverse()) {
      try {
        await runtime.stop();
      } catch (stopError) {
        logger?.error(`[gateway] failed to stop ${runtime.name} runtime after startup error`, stopError);
      }
    }
    headless.dispose();
    throw error;
  }

  let stopped = false;
  return {
    active: runtimes.length > 0,
    stop: async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;

      for (const runtime of [...runtimes].reverse()) {
        try {
          await runtime.stop();
        } catch (error) {
          logger?.error(`[gateway] failed to stop ${runtime.name} runtime`, error);
        }
      }
      headless.dispose();
    }
  };
}
