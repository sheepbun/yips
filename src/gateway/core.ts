import { normalizeIncomingMessage, validateIncomingMessage } from "#gateway/message-router";
import { GatewayRateLimiter } from "#gateway/rate-limiter";
import { GatewaySessionManager } from "#gateway/session-manager";
import type {
  GatewayDispatchResult,
  GatewayIncomingMessage,
  GatewayMessageContext,
  GatewayMessageResponse
} from "#gateway/types";

export interface GatewayCoreOptions {
  allowedSenderIds?: readonly string[];
  rateLimiter?: GatewayRateLimiter;
  sessionManager?: GatewaySessionManager;
  handleMessage: (context: GatewayMessageContext) => Promise<GatewayMessageResponse>;
}

export class GatewayCore {
  private readonly allowedSenderIds: ReadonlySet<string> | null;
  private readonly rateLimiter: GatewayRateLimiter;
  private readonly sessionManager: GatewaySessionManager;
  private readonly handleMessageFn: (context: GatewayMessageContext) => Promise<GatewayMessageResponse>;

  constructor(options: GatewayCoreOptions) {
    this.allowedSenderIds =
      options.allowedSenderIds && options.allowedSenderIds.length > 0
        ? new Set(options.allowedSenderIds)
        : null;
    this.rateLimiter =
      options.rateLimiter ??
      new GatewayRateLimiter({
        maxMessages: 20,
        windowMs: 60_000
      });
    this.sessionManager = options.sessionManager ?? new GatewaySessionManager();
    this.handleMessageFn = options.handleMessage;
  }

  async dispatch(message: GatewayIncomingMessage): Promise<GatewayDispatchResult> {
    const normalizedMessage = normalizeIncomingMessage(message);
    const validationError = validateIncomingMessage(normalizedMessage);
    if (validationError) {
      return {
        status: "invalid",
        reason: validationError
      };
    }

    if (this.allowedSenderIds && !this.allowedSenderIds.has(normalizedMessage.senderId)) {
      return {
        status: "unauthorized",
        reason: "sender_not_allowed"
      };
    }

    const rate = this.rateLimiter.check(normalizedMessage.senderId);
    if (!rate.allowed) {
      return {
        status: "rate_limited",
        reason: "rate_limit_exceeded",
        retryAfterMs: rate.retryAfterMs
      };
    }

    const session = this.sessionManager.getOrCreateSession(normalizedMessage);
    const response = await this.handleMessageFn({
      message: normalizedMessage,
      session
    });

    return {
      status: "ok",
      sessionId: session.id,
      response
    };
  }

  listSessions() {
    return this.sessionManager.listSessions();
  }

  pruneIdleSessions(maxIdleMs: number): number {
    return this.sessionManager.pruneIdleSessions(maxIdleMs);
  }

  pruneRateLimiterState(): number {
    return this.rateLimiter.pruneStaleCounters();
  }
}
