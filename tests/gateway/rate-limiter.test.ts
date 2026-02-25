import { describe, expect, it, vi } from "vitest";

import { GatewayRateLimiter } from "#gateway/rate-limiter";

describe("gateway rate-limiter", () => {
  it("allows up to max messages and then rate limits within window", () => {
    const now = vi.fn<() => Date>().mockReturnValue(new Date("2026-02-25T12:00:00.000Z"));
    const limiter = new GatewayRateLimiter({ maxMessages: 2, windowMs: 10_000 }, now);

    expect(limiter.check("user-1")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check("user-1")).toMatchObject({ allowed: true, remaining: 0 });

    const blocked = limiter.check("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets counters after window elapses", () => {
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-02-25T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-02-25T12:00:11.000Z"));
    const limiter = new GatewayRateLimiter({ maxMessages: 1, windowMs: 10_000 }, now);

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("prunes stale counters", () => {
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-02-25T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-02-25T12:00:05.000Z"))
      .mockReturnValueOnce(new Date("2026-02-25T12:00:15.000Z"));
    const limiter = new GatewayRateLimiter({ maxMessages: 2, windowMs: 10_000 }, now);

    limiter.check("user-1");
    limiter.check("user-2");
    expect(limiter.pruneStaleCounters()).toBe(2);
  });
});
