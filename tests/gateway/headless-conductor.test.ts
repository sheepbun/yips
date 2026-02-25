import { describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "#config/config";
import {
  createGatewayHeadlessMessageHandler,
  type GatewayHeadlessConductorDeps
} from "#gateway/headless-conductor";
import type { GatewayMessageContext } from "#gateway/types";

function createGatewayContext(text: string): GatewayMessageContext {
  return {
    session: {
      id: "discord.alice.c1",
      platform: "discord",
      senderId: "alice",
      channelId: "c1",
      createdAt: new Date("2026-02-25T16:00:00.000Z"),
      updatedAt: new Date("2026-02-25T16:00:00.000Z"),
      messageCount: 1
    },
    message: {
      platform: "discord",
      senderId: "alice",
      channelId: "c1",
      text
    }
  };
}

function createBaseDeps(): Partial<GatewayHeadlessConductorDeps> {
  return {
    createLlamaClient: () =>
      ({
        setModel: vi.fn(),
        chat: vi.fn(async () => ({
          text: "assistant reply",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
        }))
      }) as never,
    createVtSession: () =>
      ({
        runCommand: vi.fn(async () => ({
          exitCode: 0,
          output: "",
          timedOut: false
        })),
        dispose: vi.fn()
      }) as never,
    ensureReady: vi.fn(async () => ({ ready: true, started: false })),
    formatStartupFailure: vi.fn(() => "startup failed"),
    loadCodeContext: vi.fn(async () => null),
    toCodeContextSystemMessage: vi.fn(() => "code context"),
    createSessionFile: vi.fn(async () => ({ path: "/tmp/session.md", sessionName: "gateway" })),
    writeSessionFile: vi.fn(async () => undefined),
    estimateCompletionTokens: vi.fn(() => 5),
    estimateHistoryTokens: vi.fn(() => 10)
  };
}

describe("gateway headless conductor", () => {
  it("returns unsupported message for non-llama backend", async () => {
    const config = { ...getDefaultConfig(), backend: "claude" as const };
    const handler = await createGatewayHeadlessMessageHandler(configureOptions(config), createBaseDeps());

    const response = await handler.handleMessage(createGatewayContext("hello"));
    expect(response.text).toContain("supports backend 'llamacpp' only");
  });

  it("returns final assistant round only", async () => {
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    deps.runConductor = vi.fn(async (runtimeDeps) => {
      runtimeDeps.history.push({ role: "assistant", content: "first" });
      runtimeDeps.onAssistantText("first", false);
      runtimeDeps.history.push({ role: "assistant", content: "final answer" });
      runtimeDeps.onAssistantText("final answer", false);
      return {
        finished: true,
        rounds: 2,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 20
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(configureOptions(config), deps);
    const response = await handler.handleMessage(createGatewayContext("hello"));

    expect(response.text).toBe("final answer");
  });

  it("auto-denies risky tool calls and executes safe calls", async () => {
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    const executeTool = vi.fn(async (call) => ({
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: "safe-result"
    }));
    deps.executeTool = executeTool as never;

    let toolResultsText = "";
    deps.runConductor = vi.fn(async (runtimeDeps) => {
      const results = await runtimeDeps.executeToolCalls([
        {
          id: "danger",
          name: "run_command",
          arguments: { command: "rm -rf .", cwd: "." }
        },
        {
          id: "safe",
          name: "read_file",
          arguments: { path: "README.md" }
        }
      ]);
      toolResultsText = JSON.stringify(results);
      runtimeDeps.history.push({ role: "assistant", content: "done" });
      runtimeDeps.onAssistantText("done", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: null
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(configureOptions(config), deps);
    const response = await handler.handleMessage(createGatewayContext("run tools"));

    expect(response.text).toBe("done");
    expect(executeTool).toHaveBeenCalledOnce();
    expect(toolResultsText).toContain('"callId":"danger"');
    expect(toolResultsText).toContain('"status":"denied"');
    expect(toolResultsText).toContain('"callId":"safe"');
    expect(toolResultsText).toContain('"status":"ok"');
  });

  it("persists session files and keeps in-memory history per runtime", async () => {
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    const createSessionFile = vi.fn(async () => ({
      path: "/tmp/gateway-session.md",
      sessionName: "gateway"
    }));
    const writeSessionFile = vi.fn(async () => undefined);
    deps.createSessionFile = createSessionFile as never;
    deps.writeSessionFile = writeSessionFile as never;

    const seenHistoryLengths: number[] = [];
    deps.runConductor = vi.fn(async (runtimeDeps) => {
      seenHistoryLengths.push(runtimeDeps.history.length);
      runtimeDeps.history.push({ role: "assistant", content: "ok" });
      runtimeDeps.onAssistantText("ok", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(configureOptions(config), deps);
    const context = createGatewayContext("one");
    await handler.handleMessage(context);
    await handler.handleMessage({ ...context, message: { ...context.message, text: "two" } });

    expect(createSessionFile).toHaveBeenCalledOnce();
    expect(writeSessionFile).toHaveBeenCalledTimes(2);
    expect(seenHistoryLengths).toEqual([1, 3]);
  });

  it("starts fresh after new runtime instance", async () => {
    const config = getDefaultConfig();
    const depsA = createBaseDeps();
    const depsB = createBaseDeps();
    const historiesA: number[] = [];
    const historiesB: number[] = [];

    const runConductorA = vi.fn(async (runtimeDeps) => {
      historiesA.push(runtimeDeps.history.length);
      runtimeDeps.history.push({ role: "assistant", content: "A" });
      runtimeDeps.onAssistantText("A", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });
    const runConductorB = vi.fn(async (runtimeDeps) => {
      historiesB.push(runtimeDeps.history.length);
      runtimeDeps.history.push({ role: "assistant", content: "B" });
      runtimeDeps.onAssistantText("B", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });
    depsA.runConductor = runConductorA as never;
    depsB.runConductor = runConductorB as never;

    const handlerA = await createGatewayHeadlessMessageHandler(configureOptions(config), depsA);
    const handlerB = await createGatewayHeadlessMessageHandler(configureOptions(config), depsB);
    const context = createGatewayContext("hello");

    await handlerA.handleMessage(context);
    await handlerA.handleMessage({ ...context, message: { ...context.message, text: "next" } });
    await handlerB.handleMessage(context);

    expect(historiesA).toEqual([1, 3]);
    expect(historiesB).toEqual([1]);
  });
});

function configureOptions(config: ReturnType<typeof getDefaultConfig>) {
  return {
    config,
    username: "Gateway User",
    workingDirectory: process.cwd()
  };
}
