import { describe, expect, it } from "vitest";

import { TelegramAdapter } from "#gateway/adapters/telegram";
import type { GatewayMessageContext } from "#gateway/types";

describe("TelegramAdapter", () => {
  it("parses a webhook update into gateway incoming message", () => {
    const adapter = new TelegramAdapter({ botToken: "test-token" });

    const messages = adapter.parseInbound({
      update_id: 42,
      message: {
        message_id: 99,
        date: 1_708_862_400,
        text: "hello from telegram",
        from: { id: 1234, username: "alice" },
        chat: { id: -10_000, type: "group" }
      }
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      platform: "telegram",
      senderId: "1234",
      channelId: "-10000",
      messageId: "99",
      text: "hello from telegram",
      timestamp: new Date("2024-02-25T12:00:00.000Z"),
      metadata: {
        updateId: 42,
        chatType: "group",
        username: "alice"
      }
    });
  });

  it("parses polling envelopes and ignores non-text/invalid updates", () => {
    const adapter = new TelegramAdapter({ botToken: "test-token" });

    const messages = adapter.parseInbound({
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            message_id: 101,
            text: "first",
            from: { id: 1 },
            chat: { id: 11 }
          }
        },
        {
          update_id: 2,
          message: {
            message_id: 102,
            from: { id: 2 },
            chat: { id: 22 }
          }
        },
        {
          update_id: 3,
          message: {
            message_id: 103,
            text: "second",
            from: { id: 3 },
            chat: { id: 33 }
          }
        }
      ]
    });

    expect(messages.map((message) => message.text)).toEqual(["first", "second"]);
    expect(messages.map((message) => message.senderId)).toEqual(["1", "3"]);
  });

  it("formats outbound responses as Telegram sendMessage requests", () => {
    const adapter = new TelegramAdapter({ botToken: "secret-token" });
    const context: GatewayMessageContext = {
      session: {
        id: "telegram.1.11",
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        text: "ping",
        messageId: "777"
      }
    };

    const request = adapter.formatOutbound(context, {
      text: "  **pong** @everyone  "
    });

    expect(request).toEqual({
      method: "POST",
      endpoint: "https://api.telegram.org/botsecret-token/sendMessage",
      headers: {
        "content-type": "application/json"
      },
      body: {
        chat_id: "11",
        text: "pong @\u200Beveryone",
        reply_to_message_id: 777
      }
    });
  });

  it("splits outbound text into multiple requests when above max length", () => {
    const adapter = new TelegramAdapter({ botToken: "secret-token", maxMessageLength: 12 });
    const context: GatewayMessageContext = {
      session: {
        id: "telegram.1.11",
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        text: "ping",
        messageId: "777"
      }
    };

    const request = adapter.formatOutbound(context, {
      text: "alpha beta gamma delta"
    });

    expect(request).toEqual([
      {
        method: "POST",
        endpoint: "https://api.telegram.org/botsecret-token/sendMessage",
        headers: {
          "content-type": "application/json"
        },
        body: {
          chat_id: "11",
          text: "alpha beta",
          reply_to_message_id: 777
        }
      },
      {
        method: "POST",
        endpoint: "https://api.telegram.org/botsecret-token/sendMessage",
        headers: {
          "content-type": "application/json"
        },
        body: {
          chat_id: "11",
          text: "gamma delta"
        }
      }
    ]);
  });

  it("returns null for empty outbound text", () => {
    const adapter = new TelegramAdapter({ botToken: "test-token" });
    const context: GatewayMessageContext = {
      session: {
        id: "telegram.1.11",
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "telegram",
        senderId: "1",
        channelId: "11",
        text: "ping"
      }
    };

    expect(adapter.formatOutbound(context, { text: "   " })).toBeNull();
  });
});
