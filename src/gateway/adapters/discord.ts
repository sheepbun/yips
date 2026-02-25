import type { GatewayIncomingMessage, GatewayMessageContext, GatewayMessageResponse } from "#gateway/types";

import type { GatewayAdapter, GatewayAdapterOutboundRequest } from "#gateway/adapters/types";

interface DiscordAuthor {
  id?: string;
  username?: string;
  bot?: boolean;
  system?: boolean;
}

interface DiscordChannel {
  id?: string;
  type?: string | number;
}

interface DiscordMessageLike {
  id?: string;
  content?: string;
  channelId?: string;
  guildId?: string | null;
  webhookId?: string | null;
  createdTimestamp?: number;
  createdAt?: string | Date;
  author?: DiscordAuthor;
  channel?: DiscordChannel;
}

export interface DiscordCreateMessageBody {
  content: string;
}

export interface DiscordAdapterOptions {
  botToken: string;
  apiBaseUrl?: string;
  maxMessageLength?: number;
}

const DEFAULT_API_BASE_URL = "https://discord.com/api/v10";
const DEFAULT_MAX_MESSAGE_LENGTH = 2000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDate(value: number | string | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? undefined : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return new Date(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function toDiscordMessageLike(payload: unknown): DiscordMessageLike | null {
  if (!isObject(payload)) {
    return null;
  }
  return payload as DiscordMessageLike;
}

function splitByLimit(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) {
    return [value];
  }

  const chunks: string[] = [];
  let current = value;
  while (current.length > maxLength) {
    chunks.push(current.slice(0, maxLength));
    current = current.slice(maxLength);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function chunkDiscordMessage(text: string, maxLength = DEFAULT_MAX_MESSAGE_LENGTH): string[] {
  const normalizedMaxLength = Math.max(1, Math.trunc(maxLength));
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";
  const lines = trimmed.split("\n");
  for (const line of lines) {
    const words = line.trim().split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      const candidate = current.length === 0 ? "\n" : `${current}\n`;
      if (candidate.length <= normalizedMaxLength) {
        current = candidate;
      } else {
        chunks.push(...splitByLimit(current, normalizedMaxLength));
        current = "\n";
      }
      continue;
    }

    for (const word of words) {
      const separator = current.length === 0 || current.endsWith("\n") ? "" : " ";
      const candidate = `${current}${separator}${word}`;
      if (candidate.length <= normalizedMaxLength) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        chunks.push(...splitByLimit(current, normalizedMaxLength));
        current = "";
      }

      if (word.length > normalizedMaxLength) {
        chunks.push(...splitByLimit(word, normalizedMaxLength));
      } else {
        current = word;
      }
    }
    if (current.length > 0) {
      const candidate = `${current}\n`;
      if (candidate.length <= normalizedMaxLength) {
        current = candidate;
      } else {
        chunks.push(...splitByLimit(current, normalizedMaxLength));
        current = "";
      }
    }
  }

  if (current.length > 0) {
    chunks.push(...splitByLimit(current, normalizedMaxLength));
  }

  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}

function toInboundMessage(payload: unknown): GatewayIncomingMessage | null {
  const message = toDiscordMessageLike(payload);
  if (!message) {
    return null;
  }

  const senderId = message.author?.id;
  const username = message.author?.username;
  const text = message.content;
  const channelId = message.channelId ?? message.channel?.id;
  if (
    typeof senderId !== "string" ||
    typeof text !== "string" ||
    typeof channelId !== "string" ||
    senderId.trim().length === 0 ||
    text.trim().length === 0 ||
    channelId.trim().length === 0
  ) {
    return null;
  }

  if (message.author?.bot || message.author?.system || message.webhookId) {
    return null;
  }

  return {
    platform: "discord",
    senderId,
    channelId,
    text,
    messageId: message.id,
    timestamp: toDate(message.createdTimestamp ?? message.createdAt),
    metadata: {
      guildId: message.guildId ?? undefined,
      authorUsername: username,
      isDm: !message.guildId
    }
  };
}

export class DiscordAdapter
  implements GatewayAdapter<unknown, DiscordCreateMessageBody>
{
  readonly platform = "discord" as const;

  private readonly botToken: string;
  private readonly apiBaseUrl: string;
  private readonly maxMessageLength: number;

  constructor(options: DiscordAdapterOptions) {
    this.botToken = options.botToken.trim();
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
    this.maxMessageLength = Math.max(1, Math.trunc(options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH));
  }

  parseInbound(payload: unknown): GatewayIncomingMessage[] {
    const message = toInboundMessage(payload);
    return message ? [message] : [];
  }

  formatOutbound(
    context: GatewayMessageContext,
    response: GatewayMessageResponse
  ):
    | GatewayAdapterOutboundRequest<DiscordCreateMessageBody>
    | GatewayAdapterOutboundRequest<DiscordCreateMessageBody>[]
    | null {
    const channelId = context.session.channelId.trim() || context.message.channelId?.trim();
    if (!channelId) {
      return null;
    }

    const chunks = chunkDiscordMessage(response.text, this.maxMessageLength);
    if (chunks.length === 0) {
      return null;
    }

    const requests = chunks.map((chunk) => ({
      method: "POST" as const,
      endpoint: `${this.apiBaseUrl}/channels/${channelId}/messages`,
      headers: {
        authorization: `Bot ${this.botToken}`,
        "content-type": "application/json"
      },
      body: {
        content: chunk
      }
    }));

    return requests.length === 1 ? (requests[0] ?? null) : requests;
  }
}
