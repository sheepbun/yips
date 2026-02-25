import { DiscordAdapter } from "#gateway/adapters/discord";
import type { GatewayAdapterOutboundRequest } from "#gateway/adapters/types";
import type { GatewayDispatchResult, GatewayIncomingMessage } from "#gateway/types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

    client.on("messageCreate", (message: unknown) => {
      void this.handleDiscordMessage(message);
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

  private async handleDiscordMessage(payload: unknown): Promise<void> {
    try {
      const inboundMessages = this.adapter.parseInbound(payload);
      for (const inbound of inboundMessages) {
        const result = await this.gateway.dispatch(inbound);
        if (result.status !== "ok" || !result.response) {
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
      }
    } catch (error: unknown) {
      this.onError(error);
    }
  }
}

export function createDiscordGatewayRuntime(options: DiscordGatewayRuntimeOptions): DiscordGatewayRuntime {
  return new DiscordGatewayRuntime(options);
}
