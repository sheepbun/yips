import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HookRunResult } from "#config/hooks";
import { executeToolCall } from "#agent/tools/tool-executor";
import { FileChangeStore } from "#agent/tools/file-change-store";
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

  function context(dir: string, overrides: Partial<Parameters<typeof executeToolCall>[1]> = {}) {
    return {
      workingDirectory: dir,
      vtSession: {} as VirtualTerminalSession,
      fileChangeStore: new FileChangeStore(),
      ...overrides
    };
  }

  it("preview_write_file stages token and does not mutate file", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "notes.txt");
    await writeFile(path, "old", "utf8");

    const call: ToolCall = {
      id: "1",
      name: "preview_write_file",
      arguments: {
        path: "notes.txt",
        content: "new content"
      }
    };

    const result = await executeToolCall(call, context(dir));

    const file = await readFile(path, "utf8");
    expect(file).toBe("old");
    expect(result.status).toBe("ok");
    expect(result.output).toContain("Token:");
    expect((result.metadata?.["token"] as string).length).toBeGreaterThan(8);
    expect(result.output).toContain("--- before");
    expect(result.output).toContain("+++ after");
  });

  it("preview_edit_file stages token and does not mutate file", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "a.txt");
    await writeFile(path, "one two two", "utf8");

    const call: ToolCall = {
      id: "2",
      name: "preview_edit_file",
      arguments: {
        path: "a.txt",
        oldText: "two",
        newText: "three"
      }
    };

    const result = await executeToolCall(call, context(dir));

    const file = await readFile(path, "utf8");
    expect(file).toBe("one two two");
    expect(result.status).toBe("ok");
    expect(result.output).toContain("Token:");
  });

  it("apply_file_change mutates with valid token", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "apply.txt");
    await writeFile(path, "alpha", "utf8");
    const fileChangeStore = new FileChangeStore();

    const preview = await executeToolCall(
      {
        id: "3a",
        name: "preview_write_file",
        arguments: { path: "apply.txt", content: "beta" }
      },
      context(dir, { fileChangeStore })
    );

    const token = preview.metadata?.["token"] as string;
    const result = await executeToolCall(
      {
        id: "3b",
        name: "apply_file_change",
        arguments: { token }
      },
      context(dir, { fileChangeStore })
    );

    const file = await readFile(path, "utf8");
    expect(file).toBe("beta");
    expect(result.status).toBe("ok");
    expect(result.metadata?.["applied"]).toBe(true);
  });

  it("apply_file_change rejects invalid token", async () => {
    const dir = await makeTempDir();

    const result = await executeToolCall(
      {
        id: "4",
        name: "apply_file_change",
        arguments: { token: "missing-token" }
      },
      context(dir)
    );

    expect(result.status).toBe("error");
    expect(result.metadata?.["reason"]).toBe("invalid-or-expired-token");
  });

  it("apply_file_change rejects expired token", async () => {
    const dir = await makeTempDir();
    const fileChangeStore = new FileChangeStore({ ttlMs: 5 });

    const preview = await executeToolCall(
      {
        id: "5a",
        name: "preview_write_file",
        arguments: { path: "expire.txt", content: "x" }
      },
      context(dir, { fileChangeStore })
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    const token = preview.metadata?.["token"] as string;
    const result = await executeToolCall(
      {
        id: "5b",
        name: "apply_file_change",
        arguments: { token }
      },
      context(dir, { fileChangeStore })
    );

    expect(result.status).toBe("error");
    expect(result.metadata?.["reason"]).toBe("invalid-or-expired-token");
  });

  it("apply_file_change rejects stale preview", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "stale.txt");
    await writeFile(path, "one", "utf8");
    const fileChangeStore = new FileChangeStore();

    const preview = await executeToolCall(
      {
        id: "6a",
        name: "preview_write_file",
        arguments: { path: "stale.txt", content: "two" }
      },
      context(dir, { fileChangeStore })
    );

    await writeFile(path, "changed-outside", "utf8");

    const token = preview.metadata?.["token"] as string;
    const result = await executeToolCall(
      {
        id: "6b",
        name: "apply_file_change",
        arguments: { token }
      },
      context(dir, { fileChangeStore })
    );

    expect(result.status).toBe("error");
    expect(result.metadata?.["reason"]).toBe("stale-preview");
  });

  it("legacy write_file is translated to preview-only", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "legacy-write.txt");

    const result = await executeToolCall(
      {
        id: "7",
        name: "write_file",
        arguments: { path: "legacy-write.txt", content: "new" }
      },
      context(dir)
    );

    const content = await readFile(path, "utf8").catch(() => null);
    expect(content).toBeNull();
    expect(result.status).toBe("ok");
    expect(result.metadata?.["legacyTranslated"]).toBe(true);
    expect(result.metadata?.["token"]).toBeTypeOf("string");
  });

  it("legacy edit_file is translated to preview-only", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "legacy-edit.txt");
    await writeFile(path, "x x x", "utf8");

    const result = await executeToolCall(
      {
        id: "8",
        name: "edit_file",
        arguments: { path: "legacy-edit.txt", oldText: "x", newText: "y", replaceAll: true }
      },
      context(dir)
    );

    const content = await readFile(path, "utf8");
    expect(content).toBe("x x x");
    expect(result.status).toBe("ok");
    expect(result.metadata?.["legacyTranslated"]).toBe(true);
    expect(result.metadata?.["token"]).toBeTypeOf("string");
  });

  it("runs on-file-write hook only after apply_file_change success", async () => {
    const dir = await makeTempDir();
    const runHook = vi.fn().mockResolvedValue(makeHookResult());
    const fileChangeStore = new FileChangeStore();

    const preview = await executeToolCall(
      {
        id: "9a",
        name: "preview_write_file",
        arguments: { path: "hooked.txt", content: "hook me" }
      },
      context(dir, { fileChangeStore, runHook })
    );

    expect(runHook).not.toHaveBeenCalled();

    await executeToolCall(
      {
        id: "9b",
        name: "apply_file_change",
        arguments: { token: preview.metadata?.["token"] as string }
      },
      context(dir, { fileChangeStore, runHook })
    );

    expect(runHook).toHaveBeenCalledOnce();
    expect(runHook.mock.calls[0]?.[0]).toBe("on-file-write");
  });

  it("run_command delegates to vt session", async () => {
    const dir = await makeTempDir();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      timedOut: false,
      output: "ok"
    });

    const call: ToolCall = {
      id: "10",
      name: "run_command",
      arguments: {
        command: "pwd"
      }
    };

    const result = await executeToolCall(call, {
      workingDirectory: dir,
      vtSession: { runCommand } as unknown as VirtualTerminalSession,
      fileChangeStore: new FileChangeStore()
    });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(result.status).toBe("ok");
    expect(result.output).toBe("ok");
  });
});
