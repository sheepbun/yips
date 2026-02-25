import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import type { SkillCall, SkillResult } from "#types/app-types";
import type { VirtualTerminalSession } from "#ui/input/vt-session";

const execFileAsync = promisify(execFile);

const SEARCH_ENDPOINT = "https://duckduckgo.com/html/";
const MAX_SKILL_TIMEOUT_MS = 300_000;

interface SearchResultItem {
  title: string;
  url: string;
}

export interface SkillExecutorContext {
  workingDirectory: string;
  vtSession: VirtualTerminalSession;
  fetchImpl?: typeof fetch;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, max);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return Math.min(parsed, max);
    }
  }
  return fallback;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripHtml(input: string): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&nbsp;/gu, " ");
}

function normalizeText(input: string): string {
  return decodeEntities(stripHtml(input)).replace(/\s+/gu, " ").trim();
}

function decodeDuckDuckGoHref(href: string): string {
  try {
    const parsed = new URL(href, SEARCH_ENDPOINT);
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname === "/l/") {
      const redirected = parsed.searchParams.get("uddg");
      if (redirected && redirected.trim().length > 0) {
        return decodeURIComponent(redirected);
      }
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function parseSearchResults(html: string, maxResults: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const anchorPattern =
    /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
  let match = anchorPattern.exec(html);

  while (match && results.length < maxResults) {
    const rawHref = match[1] ?? "";
    const rawTitle = match[2] ?? "";
    const title = normalizeText(rawTitle);
    const url = decodeDuckDuckGoHref(rawHref);

    if (title.length > 0 && url.length > 0) {
      results.push({ title, url });
    }

    match = anchorPattern.exec(html);
  }

  return results;
}

export async function executeSearchSkill(
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const query = normalizeString(args["query"]) ?? normalizeString(args["q"]);
  if (!query) {
    return "search skill requires a non-empty 'query' argument.";
  }

  const maxResults = normalizePositiveInt(args["maxResults"], 5, 10);
  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      "user-agent": "yips/0"
    }
  });

  if (!response.ok) {
    return `search skill failed: HTTP ${response.status} ${response.statusText}`;
  }

  const html = await response.text();
  const results = parseSearchResults(html, maxResults);

  if (results.length === 0) {
    return `No search results found for: ${query}`;
  }

  const lines = [`Search results for: ${query}`];
  for (const [index, result] of results.entries()) {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   ${result.url}`);
  }
  return lines.join("\n");
}

export async function executeFetchSkill(
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const rawUrl = normalizeString(args["url"]);
  if (!rawUrl) {
    return "fetch skill requires a non-empty 'url' argument.";
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "fetch skill requires a valid absolute URL.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "fetch skill only supports http/https URLs.";
  }

  const maxChars = normalizePositiveInt(args["maxChars"], 6000, 20000);
  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      "user-agent": "yips/0"
    }
  });

  if (!response.ok) {
    return `fetch skill failed: HTTP ${response.status} ${response.statusText}`;
  }

  const contentType = response.headers.get("content-type") ?? "unknown";
  const body = await response.text();
  const normalized = normalizeText(body);
  const clipped = normalized.slice(0, maxChars);
  const truncated = clipped.length < normalized.length;

  const lines = [
    `Fetched: ${parsed.toString()}`,
    `Content-Type: ${contentType}`,
    "",
    clipped.length > 0 ? clipped : "(empty response body)"
  ];

  if (truncated) {
    lines.push("");
    lines.push(`[truncated at ${maxChars} chars]`);
  }

  return lines.join("\n");
}

function detectBuildCommand(workingDirectory: string): string {
  const packageJsonPath = resolve(workingDirectory, "package.json");
  if (existsSync(packageJsonPath)) {
    return "npm run build";
  }

  const makefilePath = resolve(workingDirectory, "Makefile");
  if (existsSync(makefilePath)) {
    return "make";
  }

  return "npm run build";
}

async function executeBuildSkill(
  args: Record<string, unknown>,
  context: SkillExecutorContext
): Promise<SkillResult> {
  const command = normalizeString(args["command"]) ?? detectBuildCommand(context.workingDirectory);
  const cwdArg = normalizeString(args["cwd"]) ?? ".";
  const cwd = resolve(context.workingDirectory, cwdArg);
  const timeoutMs = normalizePositiveInt(args["timeoutMs"], 120_000, MAX_SKILL_TIMEOUT_MS);

  const run = await context.vtSession.runCommand(command, {
    cwd,
    timeoutMs
  });

  return {
    callId: "",
    skill: "build",
    status: run.exitCode === 0 ? "ok" : run.timedOut ? "timeout" : "error",
    output: `Build command: ${command}\n${run.output}`.trim(),
    metadata: {
      cwd,
      command,
      exitCode: run.exitCode,
      timedOut: run.timedOut
    }
  };
}

async function executeTodosSkill(
  args: Record<string, unknown>,
  context: SkillExecutorContext
): Promise<SkillResult> {
  const pathArg = normalizeString(args["path"]) ?? ".";
  const pattern = normalizeString(args["pattern"]) ?? "TODO|FIXME|HACK|BUG";
  const maxMatches = normalizePositiveInt(args["maxMatches"], 200, 2000);
  const targetPath = resolve(context.workingDirectory, pathArg);

  try {
    const { stdout } = await execFileAsync("rg", [
      "--line-number",
      "--color",
      "never",
      "--max-count",
      String(maxMatches),
      pattern,
      targetPath
    ]);

    const trimmed = stdout.trim();
    return {
      callId: "",
      skill: "todos",
      status: "ok",
      output: trimmed.length > 0 ? trimmed : "No TODO markers found.",
      metadata: { path: targetPath, pattern, maxMatches }
    };
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const maybeCode = (error as { code?: unknown }).code;
      const maybeStdout = (error as { stdout?: unknown }).stdout;
      if (maybeCode === 1) {
        return {
          callId: "",
          skill: "todos",
          status: "ok",
          output: "No TODO markers found.",
          metadata: { path: targetPath, pattern, maxMatches }
        };
      }
      if (typeof maybeStdout === "string" && maybeStdout.trim().length > 0) {
        return {
          callId: "",
          skill: "todos",
          status: "ok",
          output: maybeStdout.trim(),
          metadata: { path: targetPath, pattern, maxMatches }
        };
      }
    }

    return {
      callId: "",
      skill: "todos",
      status: "error",
      output: `todos skill failed: ${toErrorMessage(error)}`,
      metadata: { path: targetPath, pattern, maxMatches }
    };
  }
}

async function executeVirtualTerminalSkill(
  args: Record<string, unknown>,
  context: SkillExecutorContext
): Promise<SkillResult> {
  const command = normalizeString(args["command"]);
  if (!command) {
    return {
      callId: "",
      skill: "virtual_terminal",
      status: "error",
      output: "virtual_terminal skill requires a non-empty 'command' argument."
    };
  }

  const cwdArg = normalizeString(args["cwd"]) ?? ".";
  const cwd = resolve(context.workingDirectory, cwdArg);
  const timeoutMs = normalizePositiveInt(args["timeoutMs"], 60_000, MAX_SKILL_TIMEOUT_MS);

  const run = await context.vtSession.runCommand(command, {
    cwd,
    timeoutMs
  });

  return {
    callId: "",
    skill: "virtual_terminal",
    status: run.exitCode === 0 ? "ok" : run.timedOut ? "timeout" : "error",
    output: run.output,
    metadata: {
      cwd,
      command,
      exitCode: run.exitCode,
      timedOut: run.timedOut
    }
  };
}

export async function executeSkillCall(
  call: SkillCall,
  context: SkillExecutorContext
): Promise<SkillResult> {
  try {
    if (call.name === "search") {
      const output = await executeSearchSkill(call.arguments, context.fetchImpl ?? fetch);
      return {
        callId: call.id,
        skill: call.name,
        status:
          output.startsWith("search skill failed:") || output.startsWith("search skill requires")
            ? "error"
            : "ok",
        output
      };
    }

    if (call.name === "fetch") {
      const output = await executeFetchSkill(call.arguments, context.fetchImpl ?? fetch);
      return {
        callId: call.id,
        skill: call.name,
        status:
          output.startsWith("fetch skill failed:") ||
          output.startsWith("fetch skill requires") ||
          output.startsWith("fetch skill only supports")
            ? "error"
            : "ok",
        output
      };
    }

    if (call.name === "build") {
      const result = await executeBuildSkill(call.arguments, context);
      return { ...result, callId: call.id, skill: call.name };
    }

    if (call.name === "todos") {
      const result = await executeTodosSkill(call.arguments, context);
      return { ...result, callId: call.id, skill: call.name };
    }

    if (call.name === "virtual_terminal") {
      const result = await executeVirtualTerminalSkill(call.arguments, context);
      return { ...result, callId: call.id, skill: call.name };
    }

    return {
      callId: call.id,
      skill: call.name,
      status: "error",
      output: `Unsupported skill: ${call.name}`
    };
  } catch (error) {
    return {
      callId: call.id,
      skill: call.name,
      status: "error",
      output: `${call.name} skill failed: ${toErrorMessage(error)}`
    };
  }
}
