import { describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "#gateway/adapters/telegram";
import { createTelegramGatewayRuntime } from "#gateway/runtime/telegram-bot";
import type { GatewayDispatchResult } from "#gateway/types";

function getCalls(fetchImpl: ReturnType<typeof vi.fn>, pattern: string): unknown[][] {
  return fetchImpl.mock.calls.filter((call) => String(call[0]).includes(pattern));
}

function getOutboundMessageSendCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchImpl.mock.calls.filter(
    (call) =>
      typeof call[0] === "string" &&
      String(call[0]).includes("/sendMessage") &&
      (call[1] as RequestInit | undefined)?.method === "POST"
  );
}

function getReactionSetCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return getCalls(fetchImpl, "/setMessageReaction").filter((call) => {
    const init = (call[1] ?? {}) as RequestInit;
    if (typeof init.body !== "string") {
      return false;
    }
    const body = JSON.parse(init.body) as { reaction?: unknown[] };
    return Array.isArray(body.reaction) && body.reaction.length > 0;
  });
}

function getReactionClearCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return getCalls(fetchImpl, "/setMessageReaction").filter((call) => {
    const init = (call[1] ?? {}) as RequestInit;
    if (typeof init.body !== "string") {
      return false;
    }
    const body = JSON.parse(init.body) as { reaction?: unknown[] };
    return Array.isArray(body.reaction) && body.reaction.length === 0;
  });
}

describe("TelegramGatewayRuntime", () => {
  it("polls updates, dispatches inbound message, sends typing and reaction signals, then outbound response", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "pong"
      }
    }));

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 101,
                  message: {
                    message_id: 777,
                    date: 1_708_862_400,
                    text: "ping",
                    from: { id: 1, username: "alice" },
                    chat: { id: 11, type: "private" }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1,
      typingHeartbeatMs: 100
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getCalls(fetchImpl, "/sendChatAction").length).toBeGreaterThanOrEqual(1);
    expect(getReactionSetCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionClearCalls(fetchImpl)).toHaveLength(1);
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
  });

  it("sends typing heartbeat repeatedly while dispatch is pending and stops after completion", async () => {
    let resolveDispatch: ((value: GatewayDispatchResult) => void) | undefined;
    const dispatch = vi.fn(
      async () =>
        await new Promise<GatewayDispatchResult>((resolve) => {
          resolveDispatch = resolve;
        })
    );

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 201,
                  message: {
                    message_id: 778,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 200,
      typingHeartbeatMs: 10
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(getCalls(fetchImpl, "/sendChatAction").length).toBeGreaterThanOrEqual(2);

    if (resolveDispatch === undefined) {
      throw new Error("dispatch resolver was not set");
    }
    resolveDispatch({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "pong"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const typingCountAfterDone = getCalls(fetchImpl, "/sendChatAction").length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(getCalls(fetchImpl, "/sendChatAction")).toHaveLength(typingCountAfterDone);

    await runtime.stop();
  });

  it("does not send outbound requests when dispatch result has no response", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "rate_limited",
      reason: "rate_limit_exceeded",
      retryAfterMs: 1000
    }));

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 301,
                  message: {
                    message_id: 779,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(0);
    expect(getReactionSetCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionClearCalls(fetchImpl)).toHaveLength(0);
  });

  it("handles reaction and typing failures without blocking dispatch/outbound send", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "pong"
      }
    }));
    const onError = vi.fn();

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 401,
                  message: {
                    message_id: 780,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      if (input.includes("/sendChatAction")) {
        throw new Error("typing failed");
      }
      if (input.includes("/setMessageReaction")) {
        return new Response(null, { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      onError,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
  });

  it("does not remove eyes reaction when outbound send fails", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "pong"
      }
    }));
    const onError = vi.fn();

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 451,
                  message: {
                    message_id: 782,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      if (input.includes("/sendMessage")) {
        return new Response(null, { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      onError,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getReactionSetCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionClearCalls(fetchImpl)).toHaveLength(0);
    expect(onError).toHaveBeenCalled();
  });

  it("reaction clear failure is non-fatal after successful outbound send", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "pong"
      }
    }));
    const onError = vi.fn();

    let getUpdatesCount = 0;
    let reactionCalls = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 461,
                  message: {
                    message_id: 783,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      if (input.includes("/setMessageReaction")) {
        reactionCalls += 1;
        if (reactionCalls === 2) {
          return new Response(null, { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      onError,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(getOutboundMessageSendCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionSetCalls(fetchImpl)).toHaveLength(1);
    expect(getReactionClearCalls(fetchImpl)).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
  });

  it("retries after getUpdates failure with backoff", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: { text: "pong" }
    }));
    const sleep = vi.fn(async () => undefined);
    let getUpdatesCount = 0;

    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          throw new Error("network");
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      fetchImpl,
      sleep,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 25
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.stop();

    expect(sleep).toHaveBeenCalledWith(25);
    expect(getUpdatesCount).toBe(2);
  });

  it("supports chunked outbound sequential sends through Telegram adapter", async () => {
    const dispatch = vi.fn(async (): Promise<GatewayDispatchResult> => ({
      status: "ok",
      sessionId: "telegram.1.11",
      response: {
        text: "alpha beta gamma delta"
      }
    }));

    let getUpdatesCount = 0;
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (input.includes("/getUpdates")) {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 501,
                  message: {
                    message_id: 781,
                    text: "ping",
                    from: { id: 1 },
                    chat: { id: 11 }
                  }
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const runtime = createTelegramGatewayRuntime({
      botToken: "tg-token",
      gateway: { dispatch },
      adapter: new TelegramAdapter({ botToken: "tg-token", maxMessageLength: 12 }),
      fetchImpl,
      pollTimeoutSeconds: 1,
      idleBackoffMs: 1
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runtime.stop();

    const sendCalls = getOutboundMessageSendCalls(fetchImpl);
    expect(sendCalls).toHaveLength(2);
    const firstRequest = (sendCalls[0]?.[1] ?? {}) as RequestInit;
    const secondRequest = (sendCalls[1]?.[1] ?? {}) as RequestInit;
    const firstBody = JSON.parse(String(firstRequest.body));
    const secondBody = JSON.parse(String(secondRequest.body));
    expect(firstBody.text).toBe("alpha beta");
    expect(secondBody.text).toBe("gamma delta");
  });
});
