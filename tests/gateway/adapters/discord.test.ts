import { describe, expect, it } from "vitest";

import { DiscordAdapter, chunkDiscordMessage } from "#gateway/adapters/discord";
import type { GatewayMessageContext } from "#gateway/types";

describe("DiscordAdapter", () => {
  it("parses a DM message into gateway incoming message", () => {
    const adapter = new DiscordAdapter({ botToken: "test-token" });
    const messages = adapter.parseInbound({
      id: "m1",
      content: "hello from dm",
      channelId: "dm-channel",
      guildId: null,
      createdTimestamp: 1_708_862_400_000,
      author: {
        id: "u1",
        username: "alice",
        bot: false
      }
    });

    expect(messages).toEqual([
      {
        platform: "discord",
        senderId: "u1",
        channelId: "dm-channel",
        messageId: "m1",
        text: "hello from dm",
        timestamp: new Date("2024-02-25T12:00:00.000Z"),
        metadata: {
          guildId: undefined,
          authorUsername: "alice",
          isDm: true
        }
      }
    ]);
  });

  it("parses guild text messages and ignores bot/system messages", () => {
    const adapter = new DiscordAdapter({ botToken: "test-token" });

    const valid = adapter.parseInbound({
      id: "m2",
      content: "hello guild",
      channelId: "c1",
      guildId: "g1",
      author: {
        id: "u2",
        username: "bob",
        bot: false
      }
    });
    expect(valid).toHaveLength(1);
    expect(valid[0]?.metadata).toEqual({
      guildId: "g1",
      authorUsername: "bob",
      isDm: false
    });

    expect(
      adapter.parseInbound({
        id: "m3",
        content: "from bot",
        channelId: "c1",
        guildId: "g1",
        author: {
          id: "bot1",
          bot: true
        }
      })
    ).toEqual([]);

    expect(
      adapter.parseInbound({
        id: "m4",
        content: "from webhook",
        channelId: "c1",
        guildId: "g1",
        webhookId: "w1",
        author: {
          id: "u3",
          bot: false
        }
      })
    ).toEqual([]);
  });

  it("formats outbound request with discord auth and channel target", () => {
    const adapter = new DiscordAdapter({ botToken: "secret-token" });
    const context: GatewayMessageContext = {
      session: {
        id: "discord.u1.c1",
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        text: "ping"
      }
    };

    const request = adapter.formatOutbound(context, { text: "  pong  " });
    expect(request).toEqual({
      method: "POST",
      endpoint: "https://discord.com/api/v10/channels/c1/messages",
      headers: {
        authorization: "Bot secret-token",
        "content-type": "application/json"
      },
      body: {
        content: "pong"
      }
    });
  });

  it("splits outbound content across multiple requests when above discord max length", () => {
    const adapter = new DiscordAdapter({ botToken: "token", maxMessageLength: 12 });
    const context: GatewayMessageContext = {
      session: {
        id: "discord.u1.c1",
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        text: "ping"
      }
    };

    const request = adapter.formatOutbound(context, {
      text: "alpha beta gamma delta"
    });

    expect(Array.isArray(request)).toBe(true);
    expect(request).toEqual([
      {
        method: "POST",
        endpoint: "https://discord.com/api/v10/channels/c1/messages",
        headers: {
          authorization: "Bot token",
          "content-type": "application/json"
        },
        body: {
          content: "alpha beta"
        }
      },
      {
        method: "POST",
        endpoint: "https://discord.com/api/v10/channels/c1/messages",
        headers: {
          authorization: "Bot token",
          "content-type": "application/json"
        },
        body: {
          content: "gamma delta"
        }
      }
    ]);
  });
});

describe("chunkDiscordMessage", () => {
  it("hard-splits oversized tokens when no natural boundary exists", () => {
    const chunks = chunkDiscordMessage("abcdefghijklmnopqrstuvwxyz", 10);
    expect(chunks).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });
});
