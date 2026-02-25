import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDefaultConfig } from "#config/config";
import { formatHookFailure, runHook } from "#config/hooks";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "yips-hooks-test-"));
}

describe("hooks", () => {
  it("runs configured hook with JSON stdin and YIPS_HOOK_* env vars", async () => {
    const dir = await makeTempDir();
    const stdinPath = join(dir, "stdin.json");
    const envPath = join(dir, "env.txt");
    const config = getDefaultConfig();
    config.hooks["on-file-write"] = {
      command:
        `cat > ${shellQuote(stdinPath)}; ` +
        `printf '%s|%s|%s' "$YIPS_HOOK_NAME" "$YIPS_HOOK_SESSION_NAME" "$YIPS_HOOK_FILE_PATH" > ${shellQuote(envPath)}`,
      timeoutMs: 5000
    };

    const result = await runHook(
      config,
      "on-file-write",
      { path: "src/example.ts", operation: "write_file" },
      { cwd: dir, sessionName: "session-a" }
    );

    expect(result.status).toBe("ok");
    expect(result.exitCode).toBe(0);

    const stdinPayload = JSON.parse(await readFile(stdinPath, "utf8")) as {
      hook: string;
      data: { path: string };
      sessionName: string;
    };
    expect(stdinPayload.hook).toBe("on-file-write");
    expect(stdinPayload.data.path).toBe("src/example.ts");
    expect(stdinPayload.sessionName).toBe("session-a");

    const envPayload = await readFile(envPath, "utf8");
    expect(envPayload).toBe("on-file-write|session-a|src/example.ts");
  });

  it("returns skipped when hook is not configured", async () => {
    const config = getDefaultConfig();
    const result = await runHook(config, "on-session-start", {});
    expect(result.status).toBe("skipped");
    expect(result.command).toBeNull();
  });

  it("times out long-running hooks", async () => {
    const config = getDefaultConfig();
    config.hooks["on-session-end"] = {
      command: "sleep 1",
      timeoutMs: 10
    };

    const result = await runHook(config, "on-session-end", {});
    expect(result.status).toBe("timeout");
    expect(result.timedOut).toBe(true);
    expect(formatHookFailure(result)).toContain("on-session-end");
  });
});
