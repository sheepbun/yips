import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HookRunResult } from "#config/hooks";
import { executeToolCall } from "#agent/tools/tool-executor";
import type { ToolCall } from "#types/app-types";
import type { VirtualTerminalSession } from "#ui/input/vt-session";

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "yips-tool-executor-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tool-executor", () => {
  function makeHookResult(overrides: Partial<HookRunResult> = {}): HookRunResult {
    return {
      hook: "on-file-write",
      status: "ok",
      command: "echo hook",
      cwd: "/tmp",
      message: "Hook completed successfully.",
      durationMs: 1,
      eventId: "evt-1",
      timestamp: new Date().toISOString(),
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      ...overrides
    };
  }

  it("write_file creates files and returns diff preview", async () => {
    const dir = await makeTempDir();
    const call: ToolCall = {
      id: "1",
      name: "write_file",
      arguments: {
        path: "notes.txt",
        content: "hello\nworld"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession
    });

    const file = await readFile(join(dir, "notes.txt"), "utf8");
    expect(file).toBe("hello\nworld");
    expect(result.status).toBe("ok");
    expect(result.output).toContain("--- before");
    expect(result.output).toContain("+++ after");
  });

  it("edit_file replaces first match by default", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "a.txt");
    await writeFile(path, "one two two", "utf8");

    const call: ToolCall = {
      id: "2",
      name: "edit_file",
      arguments: {
        path: "a.txt",
        oldText: "two",
        newText: "three"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession
    });

    const file = await readFile(path, "utf8");
    expect(file).toBe("one three two");
    expect(result.status).toBe("ok");
    expect(result.output).toContain("@@");
  });

  it("edit_file replaceAll updates all matches", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "b.txt");
    await writeFile(path, "x x x", "utf8");

    const call: ToolCall = {
      id: "3",
      name: "edit_file",
      arguments: {
        path: "b.txt",
        oldText: "x",
        newText: "y",
        replaceAll: true
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession
    });

    const file = await readFile(path, "utf8");
    expect(file).toBe("y y y");
    expect(result.status).toBe("ok");
  });

  it("run_command delegates to vt session", async () => {
    const dir = await makeTempDir();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      timedOut: false,
      output: "ok"
    });

    const call: ToolCall = {
      id: "4",
      name: "run_command",
      arguments: {
        command: "pwd"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: { runCommand } as unknown as VirtualTerminalSession
    });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(result.status).toBe("ok");
    expect(result.output).toBe("ok");
  });

  it("runs on-file-write hook after write_file success", async () => {
    const dir = await makeTempDir();
    const runHook = vi.fn().mockResolvedValue(makeHookResult());
    const call: ToolCall = {
      id: "5",
      name: "write_file",
      arguments: {
        path: "hooked.txt",
        content: "hook me"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(runHook).toHaveBeenCalledOnce();
    expect(runHook.mock.calls[0]?.[0]).toBe("on-file-write");
    expect(result.status).toBe("ok");
    expect(result.output).not.toContain("[hook:on-file-write]");
    expect((result.metadata?.["hook"] as { status: string }).status).toBe("ok");
  });

  it("keeps write_file successful when hook fails and appends warning", async () => {
    const dir = await makeTempDir();
    const runHook = vi.fn().mockResolvedValue(
      makeHookResult({
        status: "error",
        message: "Hook exited with a non-zero status.",
        exitCode: 2
      })
    );
    const call: ToolCall = {
      id: "6",
      name: "write_file",
      arguments: {
        path: "hook-fail.txt",
        content: "content"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(result.status).toBe("ok");
    expect(result.output).toContain("[hook:on-file-write]");
    expect((result.metadata?.["hook"] as { status: string }).status).toBe("error");
  });
});
