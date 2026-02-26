import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { formatHookFailure, type HookRunResult } from "#config/hooks";
import type { ToolCall, ToolResult } from "#types/app-types";
import { resolveToolPath } from "#agent/tools/tool-safety";
import { FileChangeStore } from "#agent/tools/file-change-store";
import { isWithinSessionRoot } from "#agent/tools/action-risk-policy";
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

async function readFileIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readCurrentContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const parentDir = dirname(path);
  await mkdir(parentDir, { recursive: true });
  const tempPath = `${path}.yips-tmp-${randomUUID()}`;
  let wroteTemp = false;

  try {
    await writeFile(tempPath, content, "utf8");
    wroteTemp = true;
    await rename(tempPath, path);
  } catch (error) {
    if (wroteTemp) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup failure
      }
    }
    throw error;
  }
}

export interface ToolExecutorContext {
  workingDirectory: string;
  vtSession: VirtualTerminalSession;
  fileChangeStore: FileChangeStore;
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

async function executePreviewWriteFile(
  call: ToolCall,
  context: ToolExecutorContext,
  options: { legacyTranslated?: boolean } = {}
): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]);
  if (!pathArg) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `${call.name} requires a non-empty 'path' argument.`
    };
  }

  const content = typeof call.arguments["content"] === "string" ? call.arguments["content"] : null;
  if (content === null) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `${call.name} requires a string 'content' argument.`
    };
  }

  const absolutePath = resolveToolPath(pathArg, context.workingDirectory);

  try {
    const before = await readFileIfExists(absolutePath);
    const diffPreview = buildDiffPreview(before, content);
    const preview = context.fileChangeStore.createPreview({
      operation: "write_file",
      absolutePath,
      before,
      after: content,
      diffPreview
    });

    const legacyTranslated = options.legacyTranslated === true;
    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: `Staged write for ${absolutePath}\nToken: ${preview.token}\n${diffPreview}`,
      metadata: {
        token: preview.token,
        path: absolutePath,
        operation: "write_file",
        diffPreview,
        bytesBefore: before.length,
        bytesAfter: content.length,
        expiresAt: preview.expiresAt,
        legacyTranslated: legacyTranslated ? true : undefined
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `preview_write_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }
}

async function executePreviewEditFile(
  call: ToolCall,
  context: ToolExecutorContext,
  options: { legacyTranslated?: boolean } = {}
): Promise<ToolResult> {
  const pathArg = normalizeString(call.arguments["path"]);
  if (!pathArg) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `${call.name} requires a non-empty 'path' argument.`
    };
  }

  const oldText = typeof call.arguments["oldText"] === "string" ? call.arguments["oldText"] : null;
  const newText = typeof call.arguments["newText"] === "string" ? call.arguments["newText"] : null;
  if (oldText === null || newText === null) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `${call.name} requires string arguments 'oldText' and 'newText'.`
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
      output: `preview_edit_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }

  if (!before.includes(oldText)) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "preview_edit_file failed: 'oldText' was not found in file.",
      metadata: { path: absolutePath }
    };
  }

  const after = replaceAll ? before.split(oldText).join(newText) : before.replace(oldText, newText);

  try {
    const diffPreview = buildDiffPreview(before, after);
    const preview = context.fileChangeStore.createPreview({
      operation: "edit_file",
      absolutePath,
      before,
      after,
      diffPreview
    });

    const legacyTranslated = options.legacyTranslated === true;
    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: `Staged edit for ${absolutePath}\nToken: ${preview.token}\n${diffPreview}`,
      metadata: {
        token: preview.token,
        path: absolutePath,
        operation: "edit_file",
        diffPreview,
        bytesBefore: before.length,
        bytesAfter: after.length,
        expiresAt: preview.expiresAt,
        replaceAll,
        legacyTranslated: legacyTranslated ? true : undefined
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `preview_edit_file failed: ${toErrorMessage(error)}`,
      metadata: { path: absolutePath }
    };
  }
}

async function executeApplyFileChange(
  call: ToolCall,
  context: ToolExecutorContext
): Promise<ToolResult> {
  const token = normalizeString(call.arguments["token"]);
  if (!token) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "apply_file_change requires a non-empty 'token' argument.",
      metadata: {
        token: token ?? "",
        reason: "missing-token"
      }
    };
  }

  const preview = context.fileChangeStore.get(token);
  if (!preview) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "apply_file_change failed: token is invalid or expired.",
      metadata: {
        token,
        reason: "invalid-or-expired-token"
      }
    };
  }

  const absolutePath = resolveToolPath(preview.absolutePath, context.workingDirectory);
  if (!isWithinSessionRoot(absolutePath, context.workingDirectory)) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "apply_file_change failed: path is outside the working zone.",
      metadata: {
        token,
        path: absolutePath,
        reason: "outside-working-zone"
      }
    };
  }

  const currentContent = await readCurrentContent(absolutePath);
  const currentHash = FileChangeStore.hashContent(currentContent ?? "");
  if (currentHash !== preview.contentHashBefore) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: "apply_file_change failed: file changed since preview; re-run preview.",
      metadata: {
        token,
        path: absolutePath,
        reason: "stale-preview"
      }
    };
  }

  try {
    await writeFileAtomic(absolutePath, preview.after);
    context.fileChangeStore.consume(token);
    const hookResult = await runFileWriteHook(context, {
      operation: preview.operation,
      path: absolutePath,
      bytesAfter: preview.after.length
    });
    const hookWarning =
      hookResult && hookResult.status !== "ok" && hookResult.status !== "skipped"
        ? `\n${formatHookFailure(hookResult)}`
        : "";

    return {
      callId: call.id,
      tool: call.name,
      status: "ok",
      output: `Applied ${preview.operation} for ${absolutePath}\n${preview.diffPreview}${hookWarning}`,
      metadata: {
        path: absolutePath,
        operation: preview.operation,
        token,
        applied: true,
        diffPreview: preview.diffPreview,
        hook: hookResult ? summarizeHookResult(hookResult) : undefined
      }
    };
  } catch (error) {
    return {
      callId: call.id,
      tool: call.name,
      status: "error",
      output: `apply_file_change failed: ${toErrorMessage(error)}`,
      metadata: {
        token,
        path: absolutePath,
        reason: "apply-write-failed"
      }
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
  if (call.name === "preview_write_file") {
    return await executePreviewWriteFile(call, context);
  }
  if (call.name === "preview_edit_file") {
    return await executePreviewEditFile(call, context);
  }
  if (call.name === "apply_file_change") {
    return await executeApplyFileChange(call, context);
  }
  if (call.name === "write_file") {
    return await executePreviewWriteFile(call, context, { legacyTranslated: true });
  }
  if (call.name === "edit_file") {
    return await executePreviewEditFile(call, context, { legacyTranslated: true });
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
