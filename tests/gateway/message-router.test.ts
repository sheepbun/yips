import { describe, expect, it } from "vitest";

import { normalizeIncomingMessage, validateIncomingMessage } from "#gateway/message-router";

describe("gateway message-router", () => {
  it("normalizes sender/channel/text and default timestamp", () => {
    const normalized = normalizeIncomingMessage({
      platform: "telegram",
      senderId: "  user-1 ",
      channelId: "  room-1 ",
      text: "  hello world  "
    });

    expect(normalized.senderId).toBe("user-1");
    expect(normalized.channelId).toBe("room-1");
    expect(normalized.text).toBe("hello world");
    expect(normalized.timestamp).toBeInstanceOf(Date);
  });

  it("validates sender and text requirements", () => {
    expect(
      validateIncomingMessage({
        platform: "discord",
        senderId: " ",
        text: "ok"
      })
    ).toBe("sender_id_required");
    expect(
      validateIncomingMessage({
        platform: "discord",
        senderId: "u1",
        text: " "
      })
    ).toBe("message_text_required");
    expect(
      validateIncomingMessage({
        platform: "discord",
        senderId: "u1",
        text: "ok"
      })
    ).toBeNull();
  });
});
