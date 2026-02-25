import { DiscordAdapter } from "#gateway/adapters/discord";
import type { GatewayAdapterOutboundRequest } from "#gateway/adapters/types";
import type { GatewayDispatchResult, GatewayIncomingMessage } from "#gateway/types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type TimerId = ReturnType<typeof setInterval>;
type StopTypingHeartbeat = () => void;

interface DiscordMessageRuntimeLike {
  react?: (emoji: string) => Promise<unknown>;
}

const EYES_REACTION = "👀";
const TYPING_HEARTBEAT_MS = 8_000;
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

export interface DiscordClientLike {
  on(event: "messageCreate", listener: (message: unknown) => void | Promise<void>): void;
  login(token: string): Promise<string>;
  destroy(): void;
}

interface DiscordJsModuleLike {
  Client: new (options: Record<string, unknown>) => DiscordClientLike;
  GatewayIntentBits?: Record<string, number>;
  Partials?: Record<string, number>;
}

export interface GatewayDispatcherLike {
  dispatch(message: GatewayIncomingMessage): Promise<GatewayDispatchResult>;
}

export interface DiscordGatewayRuntimeOptions {
  botToken: string;
  gateway: GatewayDispatcherLike;
  adapter?: DiscordAdapter;
  fetchImpl?: FetchLike;
  loadDiscordModule?: () => Promise<DiscordJsModuleLike>;
  onError?: (error: unknown) => void;
}

function defaultLoadDiscordModule(): Promise<DiscordJsModuleLike> {
  return import("discord.js") as unknown as Promise<DiscordJsModuleLike>;
}

function toRequestList<TBody>(
  request:
    | GatewayAdapterOutboundRequest<TBody>
    | GatewayAdapterOutboundRequest<TBody>[]
    | null
): GatewayAdapterOutboundRequest<TBody>[] {
  if (!request) {
    return [];
  }
  return Array.isArray(request) ? request : [request];
}

function defaultFetchImpl(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function toRuntimeMessage(payload: unknown): DiscordMessageRuntimeLike | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  return payload as DiscordMessageRuntimeLike;
}

export class DiscordGatewayRuntime {
  private readonly botToken: string;
  private readonly gateway: GatewayDispatcherLike;
  private readonly adapter: DiscordAdapter;
  private readonly fetchImpl: FetchLike;
  private readonly loadDiscordModule: () => Promise<DiscordJsModuleLike>;
  private readonly onError: (error: unknown) => void;

  private client: DiscordClientLike | null = null;

  constructor(options: DiscordGatewayRuntimeOptions) {
    this.botToken = options.botToken.trim();
    this.gateway = options.gateway;
    this.adapter = options.adapter ?? new DiscordAdapter({ botToken: this.botToken });
    this.fetchImpl = options.fetchImpl ?? defaultFetchImpl;
    this.loadDiscordModule = options.loadDiscordModule ?? defaultLoadDiscordModule;
    this.onError = options.onError ?? ((error: unknown) => console.error("[gateway/discord]", error));
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const discord = await this.loadDiscordModule();
    const intents = discord.GatewayIntentBits ?? {};
    const partials = discord.Partials ?? {};
    const client = new discord.Client({
      intents: [
        intents.Guilds,
        intents.GuildMessages,
        intents.DirectMessages,
        intents.MessageContent
      ].filter((value): value is number => typeof value === "number"),
      partials: [partials.Channel].filter((value): value is number => typeof value === "number")
    });

    client.on("messageCreate", async (message: unknown) => {
      await this.handleDiscordMessage(message);
    });

    await client.login(this.botToken);
    this.client = client;
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }
    this.client.destroy();
    this.client = null;
  }

  private async tryReactEyes(payload: unknown): Promise<void> {
    const message = toRuntimeMessage(payload);
    if (!message?.react) {
      return;
    }

    try {
      await message.react(EYES_REACTION);
    } catch (error: unknown) {
      this.onError(error);
    }
  }

  private async sendTypingIndicator(channelId: string | undefined): Promise<void> {
    const trimmedChannelId = channelId?.trim();
    if (!trimmedChannelId) {
      return;
    }

    const response = await this.fetchImpl(
      `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(trimmedChannelId)}/typing`,
      {
        method: "POST",
        headers: {
          authorization: `Bot ${this.botToken}`
        }
      }
    );
    if (!response.ok) {
      throw new Error(`discord typing failed (${response.status})`);
    }
  }

  private startTypingHeartbeat(channelId: string | undefined): StopTypingHeartbeat {
    const trimmedChannelId = channelId?.trim();
    if (!trimmedChannelId) {
      return () => {};
    }

    let stopped = false;
    const tick = (): void => {
      if (stopped) {
        return;
      }
      void this.sendTypingIndicator(trimmedChannelId).catch((error: unknown) => {
        this.onError(error);
      });
    };

    tick();
    const intervalId: TimerId = setInterval(tick, TYPING_HEARTBEAT_MS);

    return (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(intervalId);
    };
  }

  private async tryRemoveEyesReaction(inbound: GatewayIncomingMessage): Promise<void> {
    const channelId = inbound.channelId?.trim();
    const messageId = inbound.messageId?.trim();
    if (!channelId || !messageId) {
      return;
    }

    try {
      const response = await this.fetchImpl(
        `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(
          channelId
        )}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(
          EYES_REACTION
        )}/@me`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bot ${this.botToken}`
          }
        }
      );
      if (!response.ok) {
        throw new Error(`discord reaction remove failed (${response.status})`);
      }
    } catch (error: unknown) {
      this.onError(error);
    }
  }

  private async handleDiscordMessage(payload: unknown): Promise<void> {
    try {
      const inboundMessages = this.adapter.parseInbound(payload);
      for (const inbound of inboundMessages) {
        await this.tryReactEyes(payload);
        const stopTyping = this.startTypingHeartbeat(inbound.channelId);

        try {
          const result = await this.gateway.dispatch(inbound);
          if (!result.response) {
            continue;
          }

          const context = {
            session: {
              id: result.sessionId ?? `discord.${inbound.senderId}.${inbound.channelId ?? "direct"}`,
              platform: "discord" as const,
              senderId: inbound.senderId,
              channelId: inbound.channelId ?? "direct",
              createdAt: new Date(),
              updatedAt: new Date(),
              messageCount: 1
            },
            message: inbound
          };
          const requests = toRequestList(this.adapter.formatOutbound(context, result.response));
          for (const request of requests) {
            const response = await this.fetchImpl(request.endpoint, {
              method: request.method,
              headers: request.headers,
              body: request.body ? JSON.stringify(request.body) : undefined
            });
            if (!response.ok) {
              throw new Error(`discord send failed (${response.status})`);
            }
          }
        } finally {
          stopTyping();
          await this.tryRemoveEyesReaction(inbound);
        }
      }
    } catch (error: unknown) {
      this.onError(error);
    }
  }
}

export function createDiscordGatewayRuntime(options: DiscordGatewayRuntimeOptions): DiscordGatewayRuntime {
  return new DiscordGatewayRuntime(options);
}
