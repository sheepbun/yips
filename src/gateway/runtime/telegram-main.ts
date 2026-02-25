import { GatewayCore } from "#gateway/core";
import { createTelegramGatewayRuntime } from "#gateway/runtime/telegram-bot";
import { loadConfig } from "#config/config";
import { createGatewayHeadlessMessageHandler } from "#gateway/headless-conductor";
import { resolveGatewayBackendFromEnv } from "#gateway/runtime/backend-policy";

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readRequiredTelegramToken(configToken: string): string {
  const envToken = readOptionalEnv("YIPS_TELEGRAM_BOT_TOKEN");
  if (envToken) {
    return envToken;
  }
  const savedToken = configToken.trim();
  if (savedToken.length > 0) {
    return savedToken;
  }
  throw new Error(
    "Missing Telegram bot token. Set YIPS_TELEGRAM_BOT_TOKEN or configure channels.telegram.botToken."
  );
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

async function main(): Promise<void> {
  const configResult = await loadConfig();
  const botToken = readRequiredTelegramToken(configResult.config.channels.telegram.botToken);
  const allowedSenderIds = readAllowedSenders();
  const passphrase = readOptionalEnv("YIPS_GATEWAY_PASSPHRASE");
  const gatewayBackend = resolveGatewayBackendFromEnv(process.env.YIPS_GATEWAY_BACKEND);

  if (configResult.warning) {
    console.error(`[warning] ${configResult.warning}`);
  }

  const headless = await createGatewayHeadlessMessageHandler({
    config: configResult.config,
    username: "Gateway User",
    gatewayBackend
  });

  const gateway = new GatewayCore({
    allowedSenderIds: allowedSenderIds.length > 0 ? allowedSenderIds : undefined,
    passphrase,
    handleMessage: headless.handleMessage
  });

  const runtime = createTelegramGatewayRuntime({
    botToken,
    gateway
  });

  await runtime.start();
  const shutdown = async () => {
    await runtime.stop();
    headless.dispose();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[fatal] ${message}`);
  process.exitCode = 1;
});
