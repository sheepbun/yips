import { describe, expect, it, vi } from "vitest";

import { DiscordAdapter } from "#gateway/adapters/discord";
import { createDiscordGatewayRuntime, type DiscordClientLike } from "#gateway/runtime/discord-bot";
import type { GatewayDispatchResult } from "#gateway/types";

class FakeDiscordClient implements DiscordClientLike {
  private readonly listeners = new Map<string, Array<(payload: unknown) => void | Promise<void>>>();

  login = vi.fn(async () => "logged-in");
  destroy = vi.fn();

  on(event: "messageCreate", listener: (message: unknown) => void | Promise<void>): void {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  async emit(event: "messageCreate", payload: unknown): Promise<void> {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

describe("DiscordGatewayRuntime", () => {
  it("dispatches inbound messages and sends formatted outbound requests", async () => {
    const state: { client: FakeDiscordClient | null } = { client: null };
    const loadDiscordModule = async () => ({
      Client: class {
        constructor() {
          state.client = new FakeDiscordClient();
          return state.client;
        }
      } as unknown as new (options: Record<string, unknown>) => DiscordClientLike
    });

    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "discord.u1.c1",
      response: {
        text: "pong"
      }
    }));
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 })
    );
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }
    await state.client.emit("messageCreate", {
      id: "m1",
      content: "ping",
      channelId: "c1",
      author: {
        id: "u1",
        bot: false
      }
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        text: "ping"
      })
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/c1/messages",
      expect.objectContaining({
        method: "POST"
      })
    );

    await runtime.stop();
    expect(state.client.destroy).toHaveBeenCalledOnce();
  });

  it("sends multiple sequential requests for chunked responses", async () => {
    const state: { client: FakeDiscordClient | null } = { client: null };
    const loadDiscordModule = async () => ({
      Client: class {
        constructor() {
          state.client = new FakeDiscordClient();
          return state.client;
        }
      } as unknown as new (options: Record<string, unknown>) => DiscordClientLike
    });

    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "discord.u1.c1",
      response: {
        text: "alpha beta gamma delta"
      }
    }));
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 })
    );
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl,
      adapter: new DiscordAdapter({
        botToken: "secret",
        maxMessageLength: 12
      })
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }
    await state.client.emit("messageCreate", {
      id: "m1",
      content: "ping",
      channelId: "c1",
      author: {
        id: "u1",
        bot: false
      }
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(firstBody.content).toBe("alpha beta");
    expect(secondBody.content).toBe("gamma delta");
  });

  it("does not send outbound requests when dispatch result has no response", async () => {
    const state: { client: FakeDiscordClient | null } = { client: null };
    const loadDiscordModule = async () => ({
      Client: class {
        constructor() {
          state.client = new FakeDiscordClient();
          return state.client;
        }
      } as unknown as new (options: Record<string, unknown>) => DiscordClientLike
    });

    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "rate_limited",
      reason: "rate_limit_exceeded",
      retryAfterMs: 500
    }));
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 })
    );
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }
    await state.client.emit("messageCreate", {
      id: "m1",
      content: "ping",
      channelId: "c1",
      author: {
        id: "u1",
        bot: false
      }
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends outbound requests for non-ok dispatch results when response is present", async () => {
    const state: { client: FakeDiscordClient | null } = { client: null };
    const loadDiscordModule = async () => ({
      Client: class {
        constructor() {
          state.client = new FakeDiscordClient();
          return state.client;
        }
      } as unknown as new (options: Record<string, unknown>) => DiscordClientLike
    });

    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "unauthorized",
      reason: "passphrase_required",
      response: {
        text: "Access denied"
      }
    }));
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 })
    );
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }
    await state.client.emit("messageCreate", {
      id: "m1",
      content: "ping",
      channelId: "c1",
      author: {
        id: "u1",
        bot: false
      }
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
