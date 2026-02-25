import type { GatewayIncomingMessage, GatewayMessageContext, GatewayMessageResponse } from "#gateway/types";

import type { GatewayAdapter, GatewayAdapterOutboundRequest } from "#gateway/adapters/types";

interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  message_id?: number;
  date?: number;
  text?: string;
  from?: TelegramUser;
  chat?: TelegramChat;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramPollingEnvelope {
  ok?: boolean;
  result?: TelegramUpdate[];
}

export interface TelegramSendMessageBody {
  chat_id: string;
  text: string;
  reply_to_message_id?: number;
}

export interface TelegramAdapterOptions {
  botToken: string;
  apiBaseUrl?: string;
}

const DEFAULT_API_BASE_URL = "https://api.telegram.org";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!isObject(value)) {
    return null;
  }
  return value as TelegramUpdate;
}

function toInboundMessage(update: TelegramUpdate): GatewayIncomingMessage | null {
  const message = update.message;
  if (!message) {
    return null;
  }
  const text = message?.text;
  const fromId = message?.from?.id;
  const chatId = message?.chat?.id;

  if (typeof text !== "string" || typeof fromId !== "number" || typeof chatId !== "number") {
    return null;
  }

  return {
    platform: "telegram",
    senderId: fromId.toString(),
    channelId: chatId.toString(),
    text,
    messageId: message.message_id?.toString(),
    timestamp: typeof message.date === "number" ? new Date(message.date * 1000) : undefined,
    metadata: {
      updateId: update.update_id,
      chatType: message.chat?.type,
      username: message.from?.username
    }
  };
}

function parseUpdates(payload: unknown): TelegramUpdate[] {
  if (!isObject(payload)) {
    return [];
  }

  const envelope = payload as TelegramPollingEnvelope;
  if (Array.isArray(envelope.result)) {
    return envelope.result.map((item) => asTelegramUpdate(item)).filter((item) => item !== null);
  }

  const single = asTelegramUpdate(payload);
  return single ? [single] : [];
}

function parseReplyMessageId(messageId: string | undefined): number | undefined {
  if (!messageId) {
    return undefined;
  }
  const parsed = Number.parseInt(messageId, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export class TelegramAdapter
  implements GatewayAdapter<unknown, TelegramSendMessageBody>
{
  readonly platform = "telegram" as const;

  private readonly botToken: string;
  private readonly apiBaseUrl: string;

  constructor(options: TelegramAdapterOptions) {
    this.botToken = options.botToken.trim();
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  }

  parseInbound(payload: unknown): GatewayIncomingMessage[] {
    const updates = parseUpdates(payload);
    return updates
      .map((update) => toInboundMessage(update))
      .filter((message) => message !== null);
  }

  formatOutbound(
    context: GatewayMessageContext,
    response: GatewayMessageResponse
  ): GatewayAdapterOutboundRequest<TelegramSendMessageBody> | null {
    const trimmed = response.text.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const chatId =
      context.session.channelId.trim() || context.message.channelId?.trim() || context.message.senderId;

    const body: TelegramSendMessageBody = {
      chat_id: chatId,
      text: trimmed
    };

    const replyToMessageId = parseReplyMessageId(context.message.messageId);
    if (replyToMessageId !== undefined) {
      body.reply_to_message_id = replyToMessageId;
    }

    return {
      method: "POST",
      endpoint: `${this.apiBaseUrl}/bot${this.botToken}/sendMessage`,
      headers: {
        "content-type": "application/json"
      },
      body
    };
  }
}
