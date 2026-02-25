import type { SubagentCall, ToolCall, ToolName } from "./types";

const TOOL_BLOCK_REGEX = /```yips-tools\s*\n([\s\S]*?)```/u;
const ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set([
  "read_file",
  "write_file",
  "edit_file",
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

function normalizeSubagentCall(value: unknown): SubagentCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const task = value["task"];
  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }
  if (typeof task !== "string" || task.trim().length === 0) {
    return null;
  }

  const contextRaw = value["context"];
  const context = typeof contextRaw === "string" && contextRaw.trim().length > 0 ? contextRaw : undefined;

  const allowedToolsRaw = value["allowed_tools"];
  const allowedTools = Array.isArray(allowedToolsRaw)
    ? allowedToolsRaw
        .filter((item): item is ToolName => typeof item === "string" && ALLOWED_TOOLS.has(item as ToolName))
        .map((item) => item as ToolName)
    : undefined;

  const maxRoundsRaw = value["max_rounds"];
  const maxRounds =
    typeof maxRoundsRaw === "number" && Number.isInteger(maxRoundsRaw) && maxRoundsRaw > 0
      ? Math.min(maxRoundsRaw, 6)
      : undefined;

  return {
    id: id.trim(),
    task: task.trim(),
    context,
    allowedTools,
    maxRounds
  };
}

export interface ParsedToolProtocol {
  assistantText: string;
  toolCalls: ToolCall[];
  subagentCalls: SubagentCall[];
}

export function parseToolProtocol(input: string): ParsedToolProtocol {
  const match = input.match(TOOL_BLOCK_REGEX);
  if (!match) {
    return {
      assistantText: input,
      toolCalls: [],
      subagentCalls: []
    };
  }

  const jsonBody = (match[1] ?? "").trim();
  if (jsonBody.length === 0) {
    return {
      assistantText: input,
      toolCalls: [],
      subagentCalls: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    return {
      assistantText: input,
      toolCalls: [],
      subagentCalls: []
    };
  }

  if (!isRecord(parsed)) {
    return {
      assistantText: input,
      toolCalls: [],
      subagentCalls: []
    };
  }

  const normalizedTools = Array.isArray(parsed["tool_calls"])
    ? parsed["tool_calls"]
        .map((item) => normalizeToolCall(item))
        .filter((call): call is ToolCall => call !== null)
    : [];

  const normalizedSubagents = Array.isArray(parsed["subagent_calls"])
    ? parsed["subagent_calls"]
        .map((item) => normalizeSubagentCall(item))
        .filter((call): call is SubagentCall => call !== null)
    : [];

  const assistantText = input.replace(match[0], "").trim();

  return {
    assistantText,
    toolCalls: normalizedTools,
    subagentCalls: normalizedSubagents
  };
}
