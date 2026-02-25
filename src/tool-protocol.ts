import type { ToolCall, ToolName } from "./types";

const TOOL_BLOCK_REGEX = /```yips-tools\s*\n([\s\S]*?)```/u;
const ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set([
  "read_file",
  "list_dir",
  "grep",
  "run_command"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeToolCall(value: unknown): ToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const name = value["name"];
  const args = value["arguments"];

  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }
  if (typeof name !== "string" || !ALLOWED_TOOLS.has(name as ToolName)) {
    return null;
  }
  if (!isRecord(args)) {
    return null;
  }

  return {
    id: id.trim(),
    name: name as ToolName,
    arguments: args
  };
}

export interface ParsedToolProtocol {
  assistantText: string;
  toolCalls: ToolCall[];
}

export function parseToolProtocol(input: string): ParsedToolProtocol {
  const match = input.match(TOOL_BLOCK_REGEX);
  if (!match) {
    return {
      assistantText: input,
      toolCalls: []
    };
  }

  const jsonBody = (match[1] ?? "").trim();
  if (jsonBody.length === 0) {
    return {
      assistantText: input,
      toolCalls: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    return {
      assistantText: input,
      toolCalls: []
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed["tool_calls"])) {
    return {
      assistantText: input,
      toolCalls: []
    };
  }

  const normalized = parsed["tool_calls"]
    .map((item) => normalizeToolCall(item))
    .filter((call): call is ToolCall => call !== null);

  const assistantText = input.replace(match[0], "").trim();

  return {
    assistantText,
    toolCalls: normalized
  };
}
