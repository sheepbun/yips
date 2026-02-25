import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { executeToolCall } from "../src/tool-executor";
import type { ToolCall } from "../src/types";
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
});
