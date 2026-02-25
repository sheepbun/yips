import type { GatewayIncomingMessage, GatewaySession } from "#gateway/types";

const DIRECT_CHANNEL = "direct";

function sanitizeIdPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return normalized.length > 0 ? normalized : "unknown";
}

export function toConversationKey(message: Pick<GatewayIncomingMessage, "platform" | "senderId" | "channelId">): string {
  const channelId = message.channelId ?? DIRECT_CHANNEL;
  return `${message.platform}:${message.senderId}:${channelId}`;
}

export function toSessionId(message: Pick<GatewayIncomingMessage, "platform" | "senderId" | "channelId">): string {
  const channelId = message.channelId ?? DIRECT_CHANNEL;
  return [
    sanitizeIdPart(message.platform),
    sanitizeIdPart(message.senderId),
    sanitizeIdPart(channelId)
  ].join(".");
}

export class GatewaySessionManager {
  private readonly sessionsByKey = new Map<string, GatewaySession>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  getOrCreateSession(message: GatewayIncomingMessage): GatewaySession {
    const key = toConversationKey(message);
    const existing = this.sessionsByKey.get(key);
    if (existing) {
      existing.messageCount += 1;
      existing.updatedAt = this.now();
      return existing;
    }

    const now = this.now();
    const created: GatewaySession = {
      id: toSessionId(message),
      platform: message.platform,
      senderId: message.senderId,
      channelId: message.channelId ?? DIRECT_CHANNEL,
      createdAt: now,
      updatedAt: now,
      messageCount: 1
    };
    this.sessionsByKey.set(key, created);
    return created;
  }

  listSessions(): GatewaySession[] {
    return Array.from(this.sessionsByKey.values()).sort(
      (a, b) => b.updatedAt.valueOf() - a.updatedAt.valueOf()
    );
  }

  removeSession(sessionId: string): boolean {
    for (const [key, session] of this.sessionsByKey) {
      if (session.id === sessionId) {
        this.sessionsByKey.delete(key);
        return true;
      }
    }
    return false;
  }

  pruneIdleSessions(maxIdleMs: number): number {
    if (maxIdleMs <= 0) {
      return 0;
    }
    const cutoff = this.now().valueOf() - maxIdleMs;
    let removed = 0;
    for (const [key, session] of this.sessionsByKey) {
      if (session.updatedAt.valueOf() < cutoff) {
        this.sessionsByKey.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
