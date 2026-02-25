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
      reason: "sender_not_allowed",
      response: {
        text: "Access denied. Authenticate with /auth <passphrase> or contact the administrator."
      }
    });
  });

  it("requires passphrase authentication when configured", async () => {
    const handled = vi.fn(async () => ({ text: "ok" }));
    const core = new GatewayCore({
      passphrase: "secret-pass",
      handleMessage: handled
    });

    const result = await core.dispatch({
      platform: "discord",
      senderId: "alice",
      text: "hello"
    });
    expect(result).toEqual({
      status: "unauthorized",
      reason: "passphrase_required",
      response: {
        text: "Access denied. Authenticate with /auth <passphrase> or contact the administrator."
      }
    });
    expect(handled).not.toHaveBeenCalled();
  });

  it("rejects invalid passphrase auth attempts", async () => {
    const handled = vi.fn(async () => ({ text: "ok" }));
    const core = new GatewayCore({
      passphrase: "secret-pass",
      handleMessage: handled
    });

    const result = await core.dispatch({
      platform: "discord",
      senderId: "alice",
      text: "/auth no"
    });
    expect(result).toEqual({
      status: "unauthorized",
      reason: "passphrase_invalid",
      response: {
        text: "Access denied. Authenticate with /auth <passphrase> or contact the administrator."
      }
    });
    expect(handled).not.toHaveBeenCalled();
  });

  it("accepts auth command and then authorizes future messages for the sender", async () => {
    const handled = vi.fn(async () => ({ text: "ok" }));
    const core = new GatewayCore({
      passphrase: "secret-pass",
      handleMessage: handled
    });

    const authResult = await core.dispatch({
      platform: "discord",
      senderId: "alice",
      channelId: "c1",
      text: "/auth secret-pass"
    });
    expect(authResult).toEqual({
      status: "authenticated",
      response: {
        text: "Authentication successful. You can now send messages."
      }
    });
    expect(handled).not.toHaveBeenCalled();

    const messageResult = await core.dispatch({
      platform: "discord",
      senderId: "alice",
      channelId: "c2",
      text: "hello after auth"
    });
    expect(messageResult.status).toBe("ok");
    expect(messageResult.response).toEqual({
      text: "ok"
    });
    expect(handled).toHaveBeenCalledOnce();
  });

  it("keeps authentication scoped by platform and sender", async () => {
    const handled = vi.fn(async () => ({ text: "ok" }));
    const core = new GatewayCore({
      passphrase: "secret-pass",
      handleMessage: handled
    });

    await core.dispatch({
      platform: "discord",
      senderId: "alice",
      text: "/auth secret-pass"
    });

    const otherPlatform = await core.dispatch({
      platform: "telegram",
      senderId: "alice",
      text: "hello"
    });
    expect(otherPlatform.status).toBe("unauthorized");
    expect(otherPlatform.reason).toBe("passphrase_required");
    expect(handled).not.toHaveBeenCalled();
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
