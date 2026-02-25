import { describe, expect, it } from "vitest";

import { GatewayAuthPolicy } from "#gateway/auth-policy";
import type { GatewayIncomingMessage } from "#gateway/types";

function baseMessage(overrides?: Partial<GatewayIncomingMessage>): GatewayIncomingMessage {
  return {
    platform: "discord",
    senderId: "alice",
    text: "hello",
    ...overrides
  };
}

describe("gateway auth-policy", () => {
  it("authorizes when no allowlist or passphrase is configured", () => {
    const policy = new GatewayAuthPolicy({});
    expect(policy.evaluate(baseMessage())).toEqual({
      type: "authorized"
    });
  });

  it("rejects sender IDs not in allowlist", () => {
    const policy = new GatewayAuthPolicy({
      allowedSenderIds: ["bob"]
    });
    expect(policy.evaluate(baseMessage())).toEqual({
      type: "unauthorized",
      reason: "sender_not_allowed"
    });
  });

  it("requires /auth command before allowing normal messages when passphrase is set", () => {
    const policy = new GatewayAuthPolicy({
      passphrase: "secret-pass"
    });
    expect(policy.evaluate(baseMessage())).toEqual({
      type: "unauthorized",
      reason: "passphrase_required"
    });
  });

  it("accepts valid /auth command and persists sender auth state", () => {
    const policy = new GatewayAuthPolicy({
      passphrase: "secret-pass"
    });
    expect(
      policy.evaluate(
        baseMessage({
          text: "/auth secret-pass"
        })
      )
    ).toEqual({
      type: "authenticated"
    });
    expect(
      policy.evaluate(
        baseMessage({
          text: "follow-up"
        })
      )
    ).toEqual({
      type: "authorized"
    });
  });

  it("scopes sender auth state by platform and sender", () => {
    const policy = new GatewayAuthPolicy({
      passphrase: "secret-pass"
    });
    policy.evaluate(
      baseMessage({
        text: "/auth secret-pass"
      })
    );
    expect(
      policy.evaluate(
        baseMessage({
          platform: "telegram",
          text: "hello"
        })
      )
    ).toEqual({
      type: "unauthorized",
      reason: "passphrase_required"
    });
    expect(
      policy.evaluate(
        baseMessage({
          senderId: "bob",
          text: "hello"
        })
      )
    ).toEqual({
      type: "unauthorized",
      reason: "passphrase_required"
    });
  });
});
