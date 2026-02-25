import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { formatHookFailure, type HookRunResult } from "#config/hooks";
import type { ToolCall, ToolResult } from "#types/app-types";
import { resolveToolPath } from "#agent/tools/tool-safety";
import type { VirtualTerminalSession } from "#ui/input/vt-session";

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

function toLines(text: string): string[] {
  return text.split("\n");
}

function buildDiffPreview(before: string, after: string, maxBodyLines = 80): string {
  if (before === after) {
    return "No content changes.";
  }

  const oldLines = toLines(before);
  const newLines = toLines(after);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (
    oldSuffix >= prefix &&
    newSuffix >= prefix &&
    oldLines[oldSuffix] === newLines[newSuffix]
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  const removed = oldLines.slice(prefix, oldSuffix + 1);
  const added = newLines.slice(prefix, newSuffix + 1);
  const hunkLines: string[] = [];

  for (const line of removed) {
    hunkLines.push(`-${line}`);
  }
  for (const line of added) {
    hunkLines.push(`+${line}`);
  }

  const truncated = hunkLines.length > maxBodyLines;
  const shown = truncated ? hunkLines.slice(0, maxBodyLines) : hunkLines;

  const header = [
    "--- before",
    "+++ after",
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`
  ];

  if (truncated) {
    shown.push(`... truncated ${hunkLines.length - maxBodyLines} additional diff lines ...`);
  }

  return [...header, ...shown].join("\n");
}

export interface ToolExecutorContext {
  workingDirectory: string;
  vtSession: VirtualTerminalSession;
  runHook?: (name: "on-file-write", payload: Record<string, unknown>) => Promise<HookRunResult>;
}

function summarizeHookResult(hookResult: HookRunResult): Record<string, unknown> {
  return {
    status: hookResult.status,
    message: hookResult.message,
    eventId: hookResult.eventId,
    durationMs: hookResult.durationMs,
    exitCode: hookResult.exitCode,
    timedOut: hookResult.timedOut,
    stdout: hookResult.stdout,
    stderr: hookResult.stderr
  };
}

async function runFileWriteHook(
  context: ToolExecutorContext,
  payload: Record<string, unknown>
): Promise<HookRunResult | null> {
  if (!context.runHook) {
    return null;
  }

  try {
    return await context.runHook("on-file-write", payload);
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      hook: "on-file-write",
      status: "error",
      command: null,
      cwd: context.workingDirectory,
      message: `Hook execution failed: ${message}`,
      durationMs: 0,
      eventId: "unknown",
      timestamp: new Date().toISOString(),
      stdout: "",
      stderr: message,
      exitCode: null,
      signal: null,
      timedOut: false
    };
  }
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

async function executeWriteFile(call: ToolCall, context: ToolExecutorContext): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]);
  if (!pathArg) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "write_file requires a non-empty 'path' argument."
    };
  }
  const content = typeof call.arguments["content"] === "string" ? call.arguments["content"] : null;
  if (content === null) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "write_file requires a string 'content' argument."
    };
  }

  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);
  const parentDir = resolve(absolutePath, "..");
  let before = "";

  try {
    before = await readFile(absolutePath, "utf8");
  } catch {
    before = "";
  }

  try {
    await mkdir(parentDir, { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    const diffPreview = buildDiffPreview(before, content);
    const hookResult = await runFileWriteHook(context, {
      operation: "write_file",
      path: absolutePath,
      bytesAfter: content.length
    });
    const hookWarning =
      hookResult && hookResult.status !== "ok" && hookResult.status !== "skipped"
        ? `\n${formatHookFailure(hookResult)}`
        : "";
    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: `Wrote ${absolutePath}\n${diffPreview}${hookWarning}`,
      metadata: {
        path: absolutePath,
        bytes: content.length,
        diffPreview,
        hook: hookResult ? summarizeHookResult(hookResult) : undefined
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `write_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }
}

async function executeEditFile(call: ToolCall, context: ToolExecutorContext): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]);
  if (!pathArg) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "edit_file requires a non-empty 'path' argument."
    };
  }
  const oldText = typeof call.arguments["oldText"] === "string" ? call.arguments["oldText"] : null;
  const newText = typeof call.arguments["newText"] === "string" ? call.arguments["newText"] : null;
  if (oldText === null || newText === null) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "edit_file requires string arguments 'oldText' and 'newText'."
    };
  }

  const replaceAll = call.arguments["replaceAll"] === true;
  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);
  let before: string;

  try {
    before = await readFile(absolutePath, "utf8");
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `edit_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }

  if (!before.includes(oldText)) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "edit_file failed: 'oldText' was not found in file.",
      metadata: { path: absolutePath }
    };
  }

  const after = replaceAll ? before.split(oldText).join(newText) : before.replace(oldText, newText);
  try {
    await writeFile(absolutePath, after, "utf8");
    const diffPreview = buildDiffPreview(before, after);
    const hookResult = await runFileWriteHook(context, {
      operation: "edit_file",
      path: absolutePath,
      replaced: replaceAll ? "all" : "first",
      bytesAfter: after.length
    });
    const hookWarning =
      hookResult && hookResult.status !== "ok" && hookResult.status !== "skipped"
        ? `\n${formatHookFailure(hookResult)}`
        : "";
    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: `Edited ${absolutePath}\n${diffPreview}${hookWarning}`,
      metadata: {
        path: absolutePath,
        replaceAll,
        diffPreview,
        hook: hookResult ? summarizeHookResult(hookResult) : undefined
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `edit_file failed: ${toErrorMessage(error)}`,
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
  if (call.name === "write_file") {
    return await executeWriteFile(call, context);
  }
  if (call.name === "edit_file") {
    return await executeEditFile(call, context);
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
