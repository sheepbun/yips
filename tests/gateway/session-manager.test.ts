import { describe, expect, it, vi } from "vitest";

import { GatewaySessionManager, toConversationKey, toSessionId } from "#gateway/session-manager";
import type { GatewayIncomingMessage } from "#gateway/types";

describe("gateway session-manager", () => {
  it("builds stable conversation and session identifiers", () => {
    const message: GatewayIncomingMessage = {
      platform: "telegram",
      senderId: "User One",
      channelId: "Team Chat",
      text: "hello"
    };
    expect(toConversationKey(message)).toBe("telegram:User One:Team Chat");
    expect(toSessionId(message)).toBe("telegram.user-one.team-chat");
  });

  it("reuses sessions per conversation and increments message count", () => {
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-02-25T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-02-25T12:00:05.000Z"));
    const manager = new GatewaySessionManager(clock);

    const first = manager.getOrCreateSession({
      platform: "discord",
      senderId: "alice",
      text: "one"
    });
    const second = manager.getOrCreateSession({
      platform: "discord",
      senderId: "alice",
      text: "two"
    });

    expect(first.id).toBe(second.id);
    expect(second.messageCount).toBe(2);
    expect(second.updatedAt.toISOString()).toBe("2026-02-25T12:00:05.000Z");
  });

  it("prunes sessions by max idle age", () => {
    const clock = vi.fn<() => Date>().mockReturnValue(new Date("2026-02-25T12:00:00.000Z"));
    const manager = new GatewaySessionManager(clock);
    manager.getOrCreateSession({
      platform: "whatsapp",
      senderId: "a",
      text: "hello"
    });
    clock.mockReturnValue(new Date("2026-02-25T12:05:00.000Z"));

    const removed = manager.pruneIdleSessions(60_000);
    expect(removed).toBe(1);
    expect(manager.listSessions()).toHaveLength(0);
  });
});
