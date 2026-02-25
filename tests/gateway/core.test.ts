import { describe, expect, it, vi } from "vitest";

import { GatewayCore } from "#gateway/core";
import { GatewayRateLimiter } from "#gateway/rate-limiter";
import { GatewaySessionManager } from "#gateway/session-manager";
import type { GatewayMessageContext } from "#gateway/types";

describe("gateway core", () => {
  it("returns invalid for malformed messages", async () => {
    const core = new GatewayCore({
      handleMessage: async () => ({ text: "ok" })
    });
    const result = await core.dispatch({
      platform: "whatsapp",
      senderId: " ",
      text: "hello"
    });
    expect(result).toEqual({
      status: "invalid",
      reason: "sender_id_required"
    });
  });

  it("enforces allowlist authorization", async () => {
    const core = new GatewayCore({
      allowedSenderIds: ["alice"],
      handleMessage: async () => ({ text: "ok" })
    });
    const result = await core.dispatch({
      platform: "telegram",
      senderId: "bob",
      text: "hello"
    });
    expect(result).toEqual({
      status: "unauthorized",
      reason: "sender_not_allowed"
    });
  });

  it("enforces rate limits per sender", async () => {
    const now = vi.fn<() => Date>().mockReturnValue(new Date("2026-02-25T12:00:00.000Z"));
    const core = new GatewayCore({
      rateLimiter: new GatewayRateLimiter({ maxMessages: 1, windowMs: 60_000 }, now),
      handleMessage: async () => ({ text: "ok" })
    });
    await core.dispatch({
      platform: "discord",
      senderId: "alice",
      text: "one"
    });
    const blocked = await core.dispatch({
      platform: "discord",
      senderId: "alice",
      text: "two"
    });
    expect(blocked.status).toBe("rate_limited");
    expect(blocked.reason).toBe("rate_limit_exceeded");
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("routes valid messages with session context", async () => {
    let seenMessageCount = 0;
    const handled = vi.fn(async (context: GatewayMessageContext) => {
      seenMessageCount = context.session.messageCount;
      return { text: "response" };
    });
    const core = new GatewayCore({
      sessionManager: new GatewaySessionManager(() => new Date("2026-02-25T12:00:00.000Z")),
      handleMessage: handled
    });

    const result = await core.dispatch({
      platform: "telegram",
      senderId: "alice",
      channelId: "dev-room",
      text: "ping"
    });

    expect(result.status).toBe("ok");
    expect(result.sessionId).toBe("telegram.alice.dev-room");
    expect(result.response).toEqual({ text: "response" });
    expect(handled).toHaveBeenCalledOnce();
    expect(seenMessageCount).toBe(1);
  });
});
