import { GatewayCore } from "#gateway/core";
import { createDiscordGatewayRuntime } from "#gateway/runtime/discord-bot";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const botToken = readRequiredEnv("YIPS_DISCORD_BOT_TOKEN");
  const allowedSenderIds = readAllowedSenders();
  const passphrase = readOptionalEnv("YIPS_GATEWAY_PASSPHRASE");

  const gateway = new GatewayCore({
    allowedSenderIds: allowedSenderIds.length > 0 ? allowedSenderIds : undefined,
    passphrase,
    handleMessage: async (context) => ({
      text: context.message.text
    })
  });

  const runtime = createDiscordGatewayRuntime({
    botToken,
    gateway
  });

  await runtime.start();
  const shutdown = async () => {
    await runtime.stop();
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
