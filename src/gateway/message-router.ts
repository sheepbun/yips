import type { GatewayIncomingMessage } from "#gateway/types";

const MAX_TEXT_LENGTH = 4000;

export function normalizeIncomingMessage(message: GatewayIncomingMessage): GatewayIncomingMessage {
  return {
    ...message,
    senderId: message.senderId.trim(),
    channelId: message.channelId?.trim(),
    text: message.text.trim().slice(0, MAX_TEXT_LENGTH),
    timestamp: message.timestamp ?? new Date()
  };
}

export function validateIncomingMessage(message: GatewayIncomingMessage): string | null {
  if (message.senderId.trim().length === 0) {
    return "sender_id_required";
  }
  if (message.text.trim().length === 0) {
    return "message_text_required";
  }
  return null;
}
