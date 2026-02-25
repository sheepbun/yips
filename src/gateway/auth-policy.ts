import type { GatewayIncomingMessage } from "#gateway/types";

export interface GatewayAuthPolicyOptions {
  allowedSenderIds?: readonly string[];
  passphrase?: string;
}

export type GatewayAuthDecision =
  | {
      type: "authorized";
    }
  | {
      type: "authenticated";
    }
  | {
      type: "unauthorized";
      reason: "sender_not_allowed" | "passphrase_required" | "passphrase_invalid";
    };

function toSenderKey(message: GatewayIncomingMessage): string {
  return `${message.platform}:${message.senderId}`;
}

function parseAuthCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/auth")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts[0] !== "/auth") {
    return null;
  }

  return parts[1] ?? "";
}

export class GatewayAuthPolicy {
  private readonly allowedSenderIds: ReadonlySet<string> | null;
  private readonly passphrase: string | null;
  private readonly authenticatedSenders = new Set<string>();

  constructor(options: GatewayAuthPolicyOptions) {
    this.allowedSenderIds =
      options.allowedSenderIds && options.allowedSenderIds.length > 0
        ? new Set(options.allowedSenderIds)
        : null;
    this.passphrase = options.passphrase?.trim() ? options.passphrase.trim() : null;
  }

  evaluate(message: GatewayIncomingMessage): GatewayAuthDecision {
    if (this.allowedSenderIds && !this.allowedSenderIds.has(message.senderId)) {
      return {
        type: "unauthorized",
        reason: "sender_not_allowed"
      };
    }

    if (!this.passphrase) {
      return {
        type: "authorized"
      };
    }

    const senderKey = toSenderKey(message);
    if (this.authenticatedSenders.has(senderKey)) {
      return {
        type: "authorized"
      };
    }

    const authAttempt = parseAuthCommand(message.text);
    if (authAttempt === null) {
      return {
        type: "unauthorized",
        reason: "passphrase_required"
      };
    }
    if (authAttempt !== this.passphrase) {
      return {
        type: "unauthorized",
        reason: "passphrase_invalid"
      };
    }

    this.authenticatedSenders.add(senderKey);
    return {
      type: "authenticated"
    };
  }
}
