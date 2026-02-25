import { access, constants as fsConstants, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Dirent } from "node:fs";

import type { HookEvent, HookRunResult } from "./types";

export const HOOKS_DIR_ENV = "YIPS_HOOKS_DIR";

const KNOWN_EVENTS: ReadonlySet<HookEvent> = new Set([
  "on-session-start",
  "on-session-end",
  "on-file-write",
  "on-file-read",
  "pre-commit"
]);

export function resolveHooksDir(): string {
  const envDir = process.env[HOOKS_DIR_ENV]?.trim();
  if (envDir && envDir.length > 0) {
    return envDir;
  }
  return join(homedir(), ".yips", "hooks");
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findHookScript(event: HookEvent): Promise<string | null> {
  const dir = resolveHooksDir();
  const candidates = [join(dir, event), join(dir, `${event}.sh`)];
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function runHook(event: HookEvent, args: string[] = []): Promise<HookRunResult | null> {
  const scriptPath = await findHookScript(event);
  if (!scriptPath) {
    return null;
  }

  return new Promise<HookRunResult>((resolve) => {
    const child = spawn(scriptPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message
      });
    });
  });
}

export async function listHooks(): Promise<Array<{ event: HookEvent; path: string }>> {
  const dir = resolveHooksDir();
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: Array<{ event: HookEvent; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const eventName = entry.name.endsWith(".sh") ? entry.name.slice(0, -3) : entry.name;
    if (!KNOWN_EVENTS.has(eventName as HookEvent)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (await isExecutable(fullPath)) {
      results.push({ event: eventName as HookEvent, path: fullPath });
    }
  }

  return results;
}
