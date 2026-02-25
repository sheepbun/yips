import type { GatewayRateLimitState } from "#gateway/types";

export interface GatewayRateLimiterOptions {
  maxMessages: number;
  windowMs: number;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

export class GatewayRateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly counters = new Map<string, RateWindow>();
  private readonly now: () => Date;

  constructor(options: GatewayRateLimiterOptions, now: () => Date = () => new Date()) {
    this.maxMessages = Math.max(1, Math.trunc(options.maxMessages));
    this.windowMs = Math.max(1000, Math.trunc(options.windowMs));
    this.now = now;
  }

  check(senderId: string): GatewayRateLimitState {
    const now = this.now().valueOf();
    const existing = this.counters.get(senderId);
    const active =
      existing && now - existing.startedAt < this.windowMs ? existing : { count: 0, startedAt: now };
    active.count += 1;
    this.counters.set(senderId, active);

    const resetAt = new Date(active.startedAt + this.windowMs);
    if (active.count <= this.maxMessages) {
      return {
        allowed: true,
        remaining: this.maxMessages - active.count,
        retryAfterMs: 0,
        resetAt
      };
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1, active.startedAt + this.windowMs - now),
      resetAt
    };
  }

  pruneStaleCounters(): number {
    const now = this.now().valueOf();
    let removed = 0;
    for (const [senderId, window] of this.counters) {
      if (now - window.startedAt >= this.windowMs) {
        this.counters.delete(senderId);
        removed += 1;
      }
    }
    return removed;
  }
}
