import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { executeToolCall } from "../src/tool-executor";
import type { HookEvent, HookRunResult, ToolCall } from "../src/types";
import type { VirtualTerminalSession } from "../src/vt-session";

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "yips-tool-executor-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tool-executor", () => {
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

  it("invokes on-file-write hook after write_file succeeds", async () => {
    const dir = await makeTempDir();
    const runHook = vi.fn<(event: HookEvent, args: string[]) => Promise<HookRunResult | null>>()
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const call: ToolCall = {
      id: "5",
      name: "write_file",
      arguments: { path: "hook-test.txt", content: "data" }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(result.status).toBe("ok");
    expect(runHook).toHaveBeenCalledOnce();
    expect(runHook).toHaveBeenCalledWith("on-file-write", [join(dir, "hook-test.txt")]);
  });

  it("invokes on-file-write hook after edit_file succeeds", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "edit-hook.txt");
    await writeFile(path, "before", "utf8");

    const runHook = vi.fn<(event: HookEvent, args: string[]) => Promise<HookRunResult | null>>()
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const call: ToolCall = {
      id: "6",
      name: "edit_file",
      arguments: { path: "edit-hook.txt", oldText: "before", newText: "after" }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(result.status).toBe("ok");
    expect(runHook).toHaveBeenCalledOnce();
    expect(runHook).toHaveBeenCalledWith("on-file-write", [path]);
  });

  it("invokes on-file-read hook after read_file succeeds", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "read-hook.txt");
    await writeFile(path, "contents", "utf8");

    const runHook = vi.fn<(event: HookEvent, args: string[]) => Promise<HookRunResult | null>>()
      .mockResolvedValue(null);

    const call: ToolCall = {
      id: "7",
      name: "read_file",
      arguments: { path: "read-hook.txt" }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(result.status).toBe("ok");
    expect(runHook).toHaveBeenCalledOnce();
    expect(runHook).toHaveBeenCalledWith("on-file-read", [path]);
  });

  it("appends hook stderr to output when hook exits non-zero", async () => {
    const dir = await makeTempDir();
    const runHook = vi.fn<(event: HookEvent, args: string[]) => Promise<HookRunResult | null>>()
      .mockResolvedValue({ exitCode: 1, stdout: "", stderr: "lint failed" });

    const call: ToolCall = {
      id: "8",
      name: "write_file",
      arguments: { path: "lint-fail.ts", content: "const x = 1" }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      runHook
    });

    expect(result.status).toBe("ok");
    expect(result.output).toContain("Hook (on-file-write) exited 1: lint failed");
  });
});
