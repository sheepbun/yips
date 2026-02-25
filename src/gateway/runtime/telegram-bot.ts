import { TelegramAdapter } from "#gateway/adapters/telegram";
import type { GatewayAdapterOutboundRequest } from "#gateway/adapters/types";
import type { GatewayDispatchResult, GatewayIncomingMessage } from "#gateway/types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type TimerId = ReturnType<typeof setInterval>;
type SleepFn = (ms: number) => Promise<void>;

interface TelegramUpdateEnvelope {
  ok?: boolean;
  result?: unknown[];
}

interface TelegramReactionBody {
  chat_id: string;
  message_id: number;
  reaction: Array<{ type: "emoji"; emoji: string }>;
}

export interface GatewayDispatcherLike {
  dispatch(message: GatewayIncomingMessage): Promise<GatewayDispatchResult>;
}

export interface TelegramGatewayRuntimeOptions {
  botToken: string;
  gateway: GatewayDispatcherLike;
  adapter?: TelegramAdapter;
  fetchImpl?: FetchLike;
  onError?: (error: unknown) => void;
  pollTimeoutSeconds?: number;
  idleBackoffMs?: number;
  typingHeartbeatMs?: number;
  sleep?: SleepFn;
}

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const EYES_REACTION = "👀";
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_IDLE_BACKOFF_MS = 1_000;
const DEFAULT_TYPING_HEARTBEAT_MS = 4_000;

function defaultFetchImpl(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function parseUpdateId(update: unknown): number | null {
  if (typeof update !== "object" || update === null) {
    return null;
  }
  const value = (update as { update_id?: unknown }).update_id;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export class TelegramGatewayRuntime {
  private readonly botToken: string;
  private readonly gateway: GatewayDispatcherLike;
  private readonly adapter: TelegramAdapter;
  private readonly fetchImpl: FetchLike;
  private readonly onError: (error: unknown) => void;
  private readonly pollTimeoutSeconds: number;
  private readonly idleBackoffMs: number;
  private readonly typingHeartbeatMs: number;
  private readonly sleep: SleepFn;

  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private offset: number | undefined;

  constructor(options: TelegramGatewayRuntimeOptions) {
    this.botToken = options.botToken.trim();
    this.gateway = options.gateway;
    this.adapter = options.adapter ?? new TelegramAdapter({ botToken: this.botToken });
    this.fetchImpl = options.fetchImpl ?? defaultFetchImpl;
    this.onError = options.onError ?? ((error: unknown) => console.error("[gateway/telegram]", error));
    this.pollTimeoutSeconds =
      typeof options.pollTimeoutSeconds === "number" && options.pollTimeoutSeconds > 0
        ? Math.trunc(options.pollTimeoutSeconds)
        : DEFAULT_POLL_TIMEOUT_SECONDS;
    this.idleBackoffMs =
      typeof options.idleBackoffMs === "number" && options.idleBackoffMs >= 0
        ? Math.trunc(options.idleBackoffMs)
        : DEFAULT_IDLE_BACKOFF_MS;
    this.typingHeartbeatMs =
      typeof options.typingHeartbeatMs === "number" && options.typingHeartbeatMs > 0
        ? Math.trunc(options.typingHeartbeatMs)
        : DEFAULT_TYPING_HEARTBEAT_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.loopPromise = null;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.fetchUpdates();
        if (updates.length === 0) {
          await this.sleep(this.idleBackoffMs);
          continue;
        }
        for (const update of updates) {
          const updateId = parseUpdateId(update);
          if (updateId !== null) {
            this.offset = updateId + 1;
          }
          await this.handleUpdate(update);
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          if (!this.running) {
            break;
          }
        } else {
          this.onError(error);
        }
        if (!this.running) {
          break;
        }
        await this.sleep(this.idleBackoffMs);
      }
    }
  }

  private async fetchUpdates(): Promise<unknown[]> {
    this.abortController = new AbortController();
    try {
      const response = await this.fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${this.botToken}/getUpdates`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          timeout: this.pollTimeoutSeconds,
          offset: this.offset,
          allowed_updates: ["message"]
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`telegram getUpdates failed (${response.status})`);
      }

      const payload = (await response.json()) as TelegramUpdateEnvelope;
      if (!payload.ok || !Array.isArray(payload.result)) {
        return [];
      }
      return payload.result;
    } finally {
      this.abortController = null;
    }
  }

  private async sendChatActionTyping(chatId: string): Promise<void> {
    const response = await this.fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${this.botToken}/sendChatAction`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing"
      })
    });
    if (!response.ok) {
      throw new Error(`telegram sendChatAction failed (${response.status})`);
    }
  }

  private startTypingHeartbeat(chatId: string | undefined): () => void {
    const trimmedChatId = chatId?.trim();
    if (!trimmedChatId) {
      return () => {};
    }

    let stopped = false;
    const tick = (): void => {
      if (stopped) {
        return;
      }
      void this.sendChatActionTyping(trimmedChatId).catch((error: unknown) => {
        this.onError(error);
      });
    };

    tick();
    const intervalId: TimerId = setInterval(tick, this.typingHeartbeatMs);
    return (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(intervalId);
    };
  }

  private async trySetEyesReaction(inbound: GatewayIncomingMessage): Promise<void> {
    const chatId = inbound.channelId?.trim();
    const messageId = toPositiveInt(inbound.messageId);
    if (!chatId || messageId === null) {
      return;
    }

    const body: TelegramReactionBody = {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji: EYES_REACTION }]
    };

    try {
      const response = await this.fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${this.botToken}/setMessageReaction`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`telegram setMessageReaction failed (${response.status})`);
      }
    } catch (error: unknown) {
      this.onError(error);
    }
  }

  private async tryClearEyesReaction(inbound: GatewayIncomingMessage): Promise<void> {
    const chatId = inbound.channelId?.trim();
    const messageId = toPositiveInt(inbound.messageId);
    if (!chatId || messageId === null) {
      return;
    }

    const body: TelegramReactionBody = {
      chat_id: chatId,
      message_id: messageId,
      reaction: []
    };

    try {
      const response = await this.fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${this.botToken}/setMessageReaction`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`telegram clearMessageReaction failed (${response.status})`);
      }
    } catch (error: unknown) {
      this.onError(error);
    }
  }

  private async handleUpdate(update: unknown): Promise<void> {
    const inboundMessages = this.adapter.parseInbound(update);
    for (const inbound of inboundMessages) {
      await this.trySetEyesReaction(inbound);
      const stopTyping = this.startTypingHeartbeat(inbound.channelId);
      let didSendOutboundMessage = false;

      try {
        const result = await this.gateway.dispatch(inbound);
        if (!result.response) {
          continue;
        }

        const context = {
          session: {
            id: result.sessionId ?? `telegram.${inbound.senderId}.${inbound.channelId ?? "direct"}`,
            platform: "telegram" as const,
            senderId: inbound.senderId,
            channelId: inbound.channelId ?? inbound.senderId,
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
            throw new Error(`telegram send failed (${response.status})`);
          }
          didSendOutboundMessage = true;
        }
      } catch (error: unknown) {
        this.onError(error);
      } finally {
        stopTyping();
        if (didSendOutboundMessage) {
          await this.tryClearEyesReaction(inbound);
        }
      }
    }
  }
}

export function createTelegramGatewayRuntime(
  options: TelegramGatewayRuntimeOptions
): TelegramGatewayRuntime {
  return new TelegramGatewayRuntime(options);
}
