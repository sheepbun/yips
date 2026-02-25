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

interface FakeDiscordMessage {
  id: string;
  content: string;
  channelId: string;
  author: {
    id: string;
    bot: boolean;
  };
  react: ReturnType<typeof vi.fn<(emoji: string) => Promise<void>>>;
}

function createFakeDiscordMessage(overrides: Partial<FakeDiscordMessage> = {}): FakeDiscordMessage {
  const defaultMessage: FakeDiscordMessage = {
    id: "m1",
    content: "ping",
    channelId: "c1",
    author: {
      id: "u1",
      bot: false
    },
    react: vi.fn(async () => undefined)
  };

  return {
    ...defaultMessage,
    ...overrides,
    author: {
      ...defaultMessage.author,
      ...(overrides.author ?? {})
    }
  };
}

function getTypingCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchImpl.mock.calls.filter(
    (call) => typeof call[0] === "string" && String(call[0]).includes("/typing")
  );
}

function getReactionDeleteCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchImpl.mock.calls.filter(
    (call) =>
      typeof call[0] === "string" &&
      String(call[0]).includes("/reactions/") &&
      (call[1] as RequestInit | undefined)?.method === "DELETE"
  );
}

function getOutboundMessageSendCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchImpl.mock.calls.filter(
    (call) =>
      typeof call[0] === "string" &&
      String(call[0]).includes("/messages") &&
      !String(call[0]).includes("/reactions/") &&
      (call[1] as RequestInit | undefined)?.method === "POST"
  );
}

describe("DiscordGatewayRuntime", () => {
  it("reacts with eyes and sends typing heartbeat while dispatch is pending", async () => {
    vi.useFakeTimers();
    try {
      const state: { client: FakeDiscordClient | null } = { client: null };
      const loadDiscordModule = async () => ({
        Client: class {
          constructor() {
            state.client = new FakeDiscordClient();
            return state.client;
          }
        } as unknown as new (options: Record<string, unknown>) => DiscordClientLike
      });

      let resolveDispatch: ((result: GatewayDispatchResult) => void) | undefined;
      const dispatch = vi.fn(
        async () =>
          await new Promise<GatewayDispatchResult>((resolve) => {
            resolveDispatch = resolve;
          })
      );
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

      const message = createFakeDiscordMessage();
      const emitPromise = state.client.emit("messageCreate", message);
      await vi.advanceTimersByTimeAsync(8_000);

      expect(message.react).toHaveBeenCalledOnce();
      expect(message.react).toHaveBeenCalledWith("👀");
      expect(getTypingCalls(fetchImpl)).toHaveLength(2);

      if (resolveDispatch === undefined) {
        throw new Error("dispatch resolver was not set");
      }
      resolveDispatch({
        status: "ok",
        sessionId: "discord.u1.c1",
        response: {
          text: "pong"
        }
      });
      await emitPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops typing heartbeat after outbound send completes", async () => {
    vi.useFakeTimers();
    try {
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

      const message = createFakeDiscordMessage();
      await state.client.emit("messageCreate", message);

      expect(getTypingCalls(fetchImpl)).toHaveLength(1);
      expect(getReactionDeleteCalls(fetchImpl)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(getTypingCalls(fetchImpl)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

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
    const message = createFakeDiscordMessage();
    await state.client.emit("messageCreate", message);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "discord",
        senderId: "u1",
        channelId: "c1",
        text: "ping"
      })
    );
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(getOutboundMessageSendCalls(fetchImpl)[0]).toEqual([
      "https://discord.com/api/v10/channels/c1/messages",
      expect.objectContaining({
        method: "POST"
      })
    ]);
    expect(message.react).toHaveBeenCalledWith("👀");
    expect(getTypingCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionDeleteCalls(fetchImpl)).toHaveLength(1);

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
    await state.client.emit("messageCreate", createFakeDiscordMessage());

    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(2);
    const firstRequest = (getOutboundMessageSendCalls(fetchImpl)[0]?.[1] ?? {}) as RequestInit;
    const secondRequest = (getOutboundMessageSendCalls(fetchImpl)[1]?.[1] ?? {}) as RequestInit;
    const firstBody = JSON.parse(String(firstRequest.body));
    const secondBody = JSON.parse(String(secondRequest.body));
    expect(firstBody.content).toBe("alpha beta");
    expect(secondBody.content).toBe("gamma delta");
    expect(getTypingCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionDeleteCalls(fetchImpl)).toHaveLength(1);
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
    const message = createFakeDiscordMessage();
    await state.client.emit("messageCreate", message);

    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(0);
    expect(message.react).toHaveBeenCalledWith("👀");
    expect(getTypingCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionDeleteCalls(fetchImpl)).toHaveLength(1);
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
    await state.client.emit("messageCreate", createFakeDiscordMessage());

    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(getTypingCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionDeleteCalls(fetchImpl)).toHaveLength(1);
  });

  it("reaction failure does not abort dispatch and outbound send", async () => {
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
    const onError = vi.fn();
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl,
      onError
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }

    const message = createFakeDiscordMessage({
      react: vi.fn(async () => {
        throw new Error("react failed");
      })
    });
    await state.client.emit("messageCreate", message);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
  });

  it("typing failure does not abort dispatch and outbound send", async () => {
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
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/typing")) {
        throw new Error("typing failed");
      }
      return new Response(null, { status: 200 });
    });
    const onError = vi.fn();
    const runtime = createDiscordGatewayRuntime({
      botToken: "secret",
      gateway: { dispatch },
      loadDiscordModule,
      fetchImpl,
      onError
    });

    await runtime.start();
    if (!state.client) {
      throw new Error("missing fake discord client");
    }

    const message = createFakeDiscordMessage();
    await state.client.emit("messageCreate", message);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
  });
});
