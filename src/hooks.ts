import { spawn } from "node:child_process";

import type { AppConfig, HookName } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const SHUTDOWN_GRACE_MS = 500;

export type HookRunStatus = "ok" | "error" | "timeout" | "skipped";

export interface HookRunResult {
  hook: HookName;
  status: HookRunStatus;
  command: string | null;
  cwd: string;
  message: string;
  durationMs: number;
  eventId: string;
  timestamp: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export interface HookRuntimeContext {
  cwd?: string;
  sessionName?: string;
  env?: Record<string, string | undefined>;
}

function resolveHookCommand(config: AppConfig, hook: HookName): string | null {
  const configured = config.hooks[hook]?.command;
  if (typeof configured !== "string") {
    return null;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveHookTimeoutMs(config: AppConfig, hook: HookName): number {
  const configured = config.hooks[hook]?.timeoutMs;
  if (typeof configured !== "number" || !Number.isInteger(configured) || configured <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(configured, MAX_TIMEOUT_MS);
}

function createEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractFilePath(payload: Record<string, unknown>): string | null {
  const path = payload["path"];
  if (typeof path === "string" && path.trim().length > 0) {
    return path.trim();
  }
  const filePath = payload["filePath"];
  if (typeof filePath === "string" && filePath.trim().length > 0) {
    return filePath.trim();
  }
  return null;
}

export function formatHookFailure(result: HookRunResult): string {
  const base = `[hook:${result.hook}] ${result.message}`;
  if (result.status === "timeout") {
    return base;
  }
  if (result.exitCode !== null) {
    return `${base} (exit ${result.exitCode})`;
  }
  return base;
}

export async function runHook(
  config: AppConfig,
  hook: HookName,
  payload: Record<string, unknown>,
  context: HookRuntimeContext = {}
): Promise<HookRunResult> {
  const cwd = context.cwd ?? process.cwd();
  const eventId = createEventId();
  const timestamp = new Date().toISOString();
  const command = resolveHookCommand(config, hook);

  if (!command) {
    return {
      hook,
      status: "skipped",
      command: null,
      cwd,
      message: `No hook configured for ${hook}.`,
      durationMs: 0,
      eventId,
      timestamp,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      timedOut: false
    };
  }

  const timeoutMs = resolveHookTimeoutMs(config, hook);
  const filePath = extractFilePath(payload);
  const startedAt = Date.now();
  const envelope = {
    hook,
    eventId,
    timestamp,
    cwd,
    sessionName: context.sessionName ?? null,
    data: payload
  };

  return await new Promise<HookRunResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
        ...context.env,
        YIPS_HOOK_NAME: hook,
        YIPS_HOOK_EVENT_ID: eventId,
        YIPS_HOOK_TIMESTAMP: timestamp,
        YIPS_HOOK_CWD: cwd,
        YIPS_HOOK_SESSION_NAME: context.sessionName ?? "",
        YIPS_HOOK_FILE_PATH: filePath ?? ""
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const settle = (result: Omit<HookRunResult, "hook" | "eventId" | "timestamp" | "cwd">) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolveResult({
        hook,
        eventId,
        timestamp,
        cwd,
        ...result
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      settle({
        status: "error",
        command,
        message: `Hook execution failed: ${toErrorMessage(error)}`,
        durationMs: Math.max(0, Date.now() - startedAt),
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        timedOut
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        settle({
          status: "timeout",
          command,
          message: `Hook timed out after ${timeoutMs}ms.`,
          durationMs: Math.max(0, Date.now() - startedAt),
          stdout,
          stderr,
          exitCode: code,
          signal,
          timedOut: true
        });
        return;
      }

      const success = code === 0;
      settle({
        status: success ? "ok" : "error",
        command,
        message: success ? "Hook completed successfully." : "Hook exited with a non-zero status.",
        durationMs: Math.max(0, Date.now() - startedAt),
        stdout,
        stderr,
        exitCode: code,
        signal,
        timedOut: false
      });
    });

    killTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, SHUTDOWN_GRACE_MS);
    }, timeoutMs);

    const stdinPayload = `${JSON.stringify(envelope)}\n`;
    child.stdin.write(stdinPayload, "utf8", (error) => {
      if (error) {
        stderr += `stdin write failed: ${toErrorMessage(error)}\n`;
      }
      child.stdin.end();
    });
  });
}
