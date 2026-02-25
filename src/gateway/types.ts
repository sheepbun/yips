export type GatewayPlatform = "whatsapp" | "telegram" | "discord";

export interface GatewayIncomingMessage {
  platform: GatewayPlatform;
  senderId: string;
  text: string;
  messageId?: string;
  channelId?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface GatewaySession {
  id: string;
  platform: GatewayPlatform;
  senderId: string;
  channelId: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface GatewayRateLimitState {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetAt: Date;
}

export interface GatewayMessageContext {
  session: GatewaySession;
  message: GatewayIncomingMessage;
}

export interface GatewayMessageResponse {
  text: string;
  metadata?: Record<string, unknown>;
}

export type GatewayDispatchStatus =
  | "ok"
  | "authenticated"
  | "unauthorized"
  | "rate_limited"
  | "invalid";

export interface GatewayDispatchResult {
  status: GatewayDispatchStatus;
  sessionId?: string;
  response?: GatewayMessageResponse;
  reason?: string;
  retryAfterMs?: number;
}
