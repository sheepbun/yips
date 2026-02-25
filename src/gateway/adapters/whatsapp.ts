import type { GatewayIncomingMessage, GatewayMessageContext, GatewayMessageResponse } from "#gateway/types";

import type { GatewayAdapter, GatewayAdapterOutboundRequest } from "#gateway/adapters/types";

interface WhatsAppContact {
  wa_id?: string;
  profile?: {
    name?: string;
  };
}

interface WhatsAppMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

interface WhatsAppMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
}

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
}

interface WhatsAppChange {
  value?: WhatsAppValue;
}

interface WhatsAppEntry {
  id?: string;
  changes?: WhatsAppChange[];
}

interface WhatsAppWebhookEnvelope {
  entry?: WhatsAppEntry[];
}

export interface WhatsAppSendMessageBody {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    body: string;
  };
}

export interface WhatsAppAdapterOptions {
  accessToken: string;
  phoneNumberId: string;
  apiBaseUrl?: string;
  apiVersion?: string;
}

const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTimestamp(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  return new Date(seconds * 1000);
}

function findContactByWaId(contacts: WhatsAppContact[] | undefined, waId: string): WhatsAppContact | undefined {
  if (!contacts || contacts.length === 0) {
    return undefined;
  }
  return contacts.find((contact) => contact.wa_id === waId);
}

function toInboundMessage(
  message: WhatsAppMessage,
  value: WhatsAppValue,
  entryId: string | undefined
): GatewayIncomingMessage | null {
  if (message.type !== "text") {
    return null;
  }

  const senderId = message.from;
  const text = message.text?.body;
  if (typeof senderId !== "string" || typeof text !== "string") {
    return null;
  }

  const contact = findContactByWaId(value.contacts, senderId);
  return {
    platform: "whatsapp",
    senderId,
    channelId: value.metadata?.phone_number_id,
    text,
    messageId: message.id,
    timestamp: parseTimestamp(message.timestamp),
    metadata: {
      waId: contact?.wa_id ?? senderId,
      profileName: contact?.profile?.name,
      displayPhoneNumber: value.metadata?.display_phone_number,
      phoneNumberId: value.metadata?.phone_number_id,
      entryId
    }
  };
}

function parseInboundMessages(payload: unknown): GatewayIncomingMessage[] {
  if (!isObject(payload)) {
    return [];
  }

  const envelope = payload as WhatsAppWebhookEnvelope;
  if (!Array.isArray(envelope.entry)) {
    return [];
  }

  const messages: GatewayIncomingMessage[] = [];
  for (const entry of envelope.entry) {
    if (!Array.isArray(entry.changes)) {
      continue;
    }
    for (const change of entry.changes) {
      const value = change.value;
      if (!value || !Array.isArray(value.messages)) {
        continue;
      }
      for (const message of value.messages) {
        const inbound = toInboundMessage(message, value, entry.id);
        if (inbound) {
          messages.push(inbound);
        }
      }
    }
  }

  return messages;
}

export class WhatsAppAdapter
  implements GatewayAdapter<unknown, WhatsAppSendMessageBody>
{
  readonly platform = "whatsapp" as const;

  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;

  constructor(options: WhatsAppAdapterOptions) {
    this.accessToken = options.accessToken.trim();
    this.phoneNumberId = options.phoneNumberId.trim();
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
    this.apiVersion = (options.apiVersion ?? DEFAULT_API_VERSION).trim();
  }

  parseInbound(payload: unknown): GatewayIncomingMessage[] {
    return parseInboundMessages(payload);
  }

  formatOutbound(
    context: GatewayMessageContext,
    response: GatewayMessageResponse
  ): GatewayAdapterOutboundRequest<WhatsAppSendMessageBody> | null {
    const trimmed = response.text.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return {
      method: "POST",
      endpoint: `${this.apiBaseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json"
      },
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: context.message.senderId,
        type: "text",
        text: {
          body: trimmed
        }
      }
    };
  }
}
