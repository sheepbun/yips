import { describe, expect, it } from "vitest";

import { WhatsAppAdapter } from "#gateway/adapters/whatsapp";
import type { GatewayMessageContext } from "#gateway/types";

describe("WhatsAppAdapter", () => {
  it("parses a cloud api webhook text message into gateway incoming message", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      phoneNumberId: "1234567890"
    });

    const messages = adapter.parseInbound({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15551234567",
                  phone_number_id: "1234567890"
                },
                contacts: [
                  {
                    wa_id: "15550001111",
                    profile: {
                      name: "Alice"
                    }
                  }
                ],
                messages: [
                  {
                    from: "15550001111",
                    id: "wamid.HBgN",
                    timestamp: "1708862400",
                    type: "text",
                    text: {
                      body: "hello from whatsapp"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([
      {
        platform: "whatsapp",
        senderId: "15550001111",
        channelId: "1234567890",
        messageId: "wamid.HBgN",
        text: "hello from whatsapp",
        timestamp: new Date("2024-02-25T12:00:00.000Z"),
        metadata: {
          waId: "15550001111",
          profileName: "Alice",
          displayPhoneNumber: "15551234567",
          phoneNumberId: "1234567890",
          entryId: "WABA_1"
        }
      }
    ]);
  });

  it("parses multi-entry envelopes and ignores invalid/non-text messages", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      phoneNumberId: "1234567890"
    });

    const messages = adapter.parseInbound({
      entry: [
        {
          id: "WABA_1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1234567890" },
                messages: [
                  {
                    from: "15550000001",
                    id: "wamid.1",
                    timestamp: "1708862400",
                    type: "text",
                    text: { body: "first" }
                  },
                  {
                    from: "15550000002",
                    id: "wamid.2",
                    timestamp: "1708862401",
                    type: "image"
                  }
                ]
              }
            }
          ]
        },
        {
          id: "WABA_2",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1234567899" },
                messages: [
                  {
                    from: "15550000003",
                    id: "wamid.3",
                    timestamp: "not-a-number",
                    type: "text",
                    text: { body: "second" }
                  },
                  {
                    id: "wamid.4",
                    timestamp: "1708862402",
                    type: "text",
                    text: { body: "missing sender" }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.text)).toEqual(["first", "second"]);
    expect(messages.map((message) => message.senderId)).toEqual(["15550000001", "15550000003"]);
    expect(messages[1]?.timestamp).toBeUndefined();
  });

  it("ignores status-only payloads", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      phoneNumberId: "1234567890"
    });

    const messages = adapter.parseInbound({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.status"
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([]);
  });

  it("formats outbound responses as cloud api messages requests", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "secret-token",
      phoneNumberId: "1234567890"
    });
    const context: GatewayMessageContext = {
      session: {
        id: "whatsapp.15550001111.1234567890",
        platform: "whatsapp",
        senderId: "15550001111",
        channelId: "1234567890",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "whatsapp",
        senderId: "15550001111",
        channelId: "1234567890",
        text: "ping"
      }
    };

    const request = adapter.formatOutbound(context, {
      text: "  pong  "
    });

    expect(request).toEqual({
      method: "POST",
      endpoint: "https://graph.facebook.com/v21.0/1234567890/messages",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "15550001111",
        type: "text",
        text: {
          body: "pong"
        }
      }
    });
  });

  it("returns null for empty outbound text", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      phoneNumberId: "1234567890"
    });
    const context: GatewayMessageContext = {
      session: {
        id: "whatsapp.15550001111.1234567890",
        platform: "whatsapp",
        senderId: "15550001111",
        channelId: "1234567890",
        createdAt: new Date("2026-02-25T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        messageCount: 1
      },
      message: {
        platform: "whatsapp",
        senderId: "15550001111",
        channelId: "1234567890",
        text: "ping"
      }
    };

    expect(adapter.formatOutbound(context, { text: "   " })).toBeNull();
  });
});
