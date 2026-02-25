import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ToolCall, ToolResult } from "./types";
import { resolveToolPath } from "./tool-safety";
import type { VirtualTerminalSession } from "./vt-session";

const execFileAsync = promisify(execFile);

function normalizePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, max);
  }
  return fallback;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ToolExecutorContext {
  workingDirectory: string;
  vtSession: VirtualTerminalSession;
}

async function executeReadFile(call: ToolCall, context: ToolExecutorContext): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]);
  if (!pathArg) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "read_file requires a non-empty 'path' argument."
    };
  }

  const maxBytes = normalizePositiveInt(call.arguments["maxBytes"], 200_000, 500_000);
  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);

  try {
    const content = await readFile(absolutePath, "utf8");
    const clipped = content.slice(0, maxBytes);
    const truncated = clipped.length < content.length;
    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: truncated ? `${clipped}\n\n[truncated at ${maxBytes} bytes]` : clipped,
      metadata: { path: absolutePath, maxBytes, truncated }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `read_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }
}

async function executeListDir(call: ToolCall, context: ToolExecutorContext): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]) ?? ".";
  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);

  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const lines = entries
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
      .sort((a, b) => a.localeCompare(b));

    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: lines.join("\n"),
      metadata: { path: absolutePath, count: lines.length }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `list_dir failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }
}

async function executeGrep(call: ToolCall, context: ToolExecutorContext): Promise<ToolResult> {
  const pattern = normalizeString(call.arguments["pattern"]);
  if (!pattern) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "grep requires a non-empty 'pattern' argument."
    };
  }

  const pathArg = normalizeString(call.arguments["path"]) ?? ".";
  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);
  const maxMatches = normalizePositiveInt(call.arguments["maxMatches"], 200, 2_000);

  try {
    const { stdout } = await execFileAsync("rg", [
      "--line-number",
      "--color",
      "never",
      "--max-count",
      String(maxMatches),
      pattern,
      absolutePath
    ]);

    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: stdout.trim(),
      metadata: { path: absolutePath, maxMatches }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `grep failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath, maxMatches }
    };
  }
}

async function executeRunCommand(
  call: ToolCall,
  context: ToolExecutorContext
): Promise<ToolResult> {
  const command = normalizeString(call.arguments["command"]);
  if (!command) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "run_command requires a non-empty 'command' argument."
    };
  }

  const cwdArg = normalizeString(call.arguments["cwd"]) ?? ".";
  const cwd = resolve(resolveToolPath(cwdArg, context.workingDirectory));
  const timeoutMs = normalizePositiveInt(call.arguments["timeoutMs"], 60_000, 120_000);

  try {
    const result = await context.vtSession.runCommand(command, { cwd, timeoutMs });
    return {
      callId: call.id,
      tool: call.name,
      status: result.exitCode === 0 ? "ok" : result.timedOut ? "timeout" : "error",
      output: result.output,
      metadata: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cwd
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `run_command failed: ${toErrorMessage(error)}`,
      metadata: { cwd }
    };
  }
}

export async function executeToolCall(
  call: ToolCall,
  context: ToolExecutorContext
): Promise<ToolResult> {
  if (call.name === "read_file") {
    return await executeReadFile(call, context);
  }
  if (call.name === "list_dir") {
    return await executeListDir(call, context);
  }
  if (call.name === "grep") {
    return await executeGrep(call, context);
  }
  if (call.name === "run_command") {
    return await executeRunCommand(call, context);
  }

  return {
    callId: call.id,
    tool: call.name,
    status: "error",
    output: `Unsupported tool: ${call.name}`
  };
}
