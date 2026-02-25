import { GatewayAuthPolicy } from "#gateway/auth-policy";
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
  passphrase?: string;
  unauthorizedMessage?: string;
  rateLimiter?: GatewayRateLimiter;
  sessionManager?: GatewaySessionManager;
  handleMessage: (context: GatewayMessageContext) => Promise<GatewayMessageResponse>;
}

export class GatewayCore {
  private readonly authPolicy: GatewayAuthPolicy;
  private readonly unauthorizedMessage: string;
  private readonly rateLimiter: GatewayRateLimiter;
  private readonly sessionManager: GatewaySessionManager;
  private readonly handleMessageFn: (context: GatewayMessageContext) => Promise<GatewayMessageResponse>;

  constructor(options: GatewayCoreOptions) {
    this.authPolicy = new GatewayAuthPolicy({
      allowedSenderIds: options.allowedSenderIds,
      passphrase: options.passphrase
    });
    this.unauthorizedMessage =
      options.unauthorizedMessage ??
      "Access denied. Authenticate with /auth <passphrase> or contact the administrator.";
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

    const authDecision = this.authPolicy.evaluate(normalizedMessage);
    if (authDecision.type === "authenticated") {
      return {
        status: "authenticated",
        response: {
          text: "Authentication successful. You can now send messages."
        }
      };
    }
    if (authDecision.type === "unauthorized") {
      return {
        status: "unauthorized",
        reason: authDecision.reason,
        response: {
          text: this.unauthorizedMessage
        }
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
