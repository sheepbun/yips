import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { executeToolCall } from "#agent/tools/tool-executor";
import { FileChangeStore } from "#agent/tools/file-change-store";
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
    createFileChangeStore: () => new FileChangeStore(),
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

  it("allows llama gateway override when app backend is non-llama", async () => {
    const config = { ...getDefaultConfig(), backend: "claude" as const };
    const deps = createBaseDeps();
    deps.runConductor = vi.fn(async (runtimeDeps) => {
      runtimeDeps.history.push({ role: "assistant", content: "gateway llama override ok" });
      runtimeDeps.onAssistantText("gateway llama override ok", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 3
      };
    });
    const handler = await createGatewayHeadlessMessageHandler(
      configureOptions(config, { gatewayBackend: "llamacpp" }),
      deps
    );

    const response = await handler.handleMessage(createGatewayContext("hello"));
    expect(response.text).toBe("gateway llama override ok");
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

  it("surfaces non-fatal startup warnings in response metadata once", async () => {
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    const ensureReady = vi
      .fn()
      .mockResolvedValueOnce({
        ready: true,
        started: true,
        warnings: ["GPU offload requested but no devices detected."]
      })
      .mockResolvedValueOnce({
        ready: true,
        started: false,
        warnings: ["GPU offload requested but no devices detected."]
      });
    deps.ensureReady = ensureReady as never;
    deps.runConductor = vi.fn(async (runtimeDeps) => {
      await runtimeDeps.requestAssistant();
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
    const first = await handler.handleMessage(createGatewayContext("one"));
    const second = await handler.handleMessage(createGatewayContext("two"));

    expect(first.text).toBe("ok");
    expect(first.metadata?.["startupWarnings"]).toEqual([
      "GPU offload requested but no devices detected."
    ]);
    expect(second.metadata).toBeUndefined();
  });

  it("applies previewed file changes in gateway with token flow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yips-gateway-preview-apply-"));
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    deps.executeTool = executeToolCall as never;

    deps.runConductor = vi.fn(async (runtimeDeps) => {
      const previewResults = await runtimeDeps.executeToolCalls([
        {
          id: "t1",
          name: "preview_write_file",
          arguments: { path: "file.txt", content: "hello" }
        }
      ]);
      const token = previewResults[0]?.metadata?.["token"];
      const applyResults = await runtimeDeps.executeToolCalls([
        {
          id: "t2",
          name: "apply_file_change",
          arguments: { token }
        }
      ]);

      expect(previewResults[0]?.status).toBe("ok");
      expect(applyResults[0]?.status).toBe("ok");
      runtimeDeps.history.push({ role: "assistant", content: "done" });
      runtimeDeps.onAssistantText("done", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(
      configureOptions(config, { workingDirectory: dir }),
      deps
    );
    const response = await handler.handleMessage(createGatewayContext("run tools"));

    expect(response.text).toBe("done");
    const content = await readFile(join(dir, "file.txt"), "utf8");
    expect(content).toBe("hello");
  });

  it("rejects apply_file_change without valid token in gateway", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yips-gateway-apply-invalid-"));
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    deps.executeTool = executeToolCall as never;

    deps.runConductor = vi.fn(async (runtimeDeps) => {
      const results = await runtimeDeps.executeToolCalls([
        {
          id: "t1",
          name: "apply_file_change",
          arguments: { token: "invalid" }
        }
      ]);

      expect(results[0]?.status).toBe("error");
      expect(results[0]?.metadata?.["reason"]).toBe("invalid-or-expired-token");
      runtimeDeps.history.push({ role: "assistant", content: "done" });
      runtimeDeps.onAssistantText("done", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(
      configureOptions(config, { workingDirectory: dir }),
      deps
    );
    const response = await handler.handleMessage(createGatewayContext("run tools"));
    expect(response.text).toBe("done");
  });

  it("rejects expired token apply in gateway without mutating file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yips-gateway-apply-expired-"));
    await writeFile(join(dir, "exp.txt"), "start", "utf8");
    const config = getDefaultConfig();
    const deps = createBaseDeps();
    deps.executeTool = executeToolCall as never;
    deps.createFileChangeStore = () => new FileChangeStore({ ttlMs: 5 });

    deps.runConductor = vi.fn(async (runtimeDeps) => {
      const preview = await runtimeDeps.executeToolCalls([
        {
          id: "t1",
          name: "preview_write_file",
          arguments: { path: "exp.txt", content: "after" }
        }
      ]);
      const token = preview[0]?.metadata?.["token"] as string;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 15);
      });

      const apply = await runtimeDeps.executeToolCalls([
        {
          id: "t2",
          name: "apply_file_change",
          arguments: { token }
        }
      ]);
      expect(apply[0]?.status).toBe("error");
      runtimeDeps.history.push({ role: "assistant", content: "done" });
      runtimeDeps.onAssistantText("done", false);
      return {
        finished: true,
        rounds: 1,
        latestOutputTokensPerSecond: null,
        usedTokensExact: 0
      };
    });

    const handler = await createGatewayHeadlessMessageHandler(
      configureOptions(config, { workingDirectory: dir }),
      deps
    );
    await handler.handleMessage(createGatewayContext("run tools"));
    const content = await readFile(join(dir, "exp.txt"), "utf8");
    expect(content).toBe("start");
  });
});

function configureOptions(
  config: ReturnType<typeof getDefaultConfig>,
  overrides: {
    gatewayBackend?: ReturnType<typeof getDefaultConfig>["backend"];
    workingDirectory?: string;
  } = {}
) {
  return {
    config,
    username: "Gateway User",
    workingDirectory: overrides.workingDirectory ?? process.cwd(),
    gatewayBackend: overrides.gatewayBackend
  };
}
