import type { SkillCall, SkillName, SubagentCall, ToolCall, ToolName } from "#types/app-types";

import type { AgentActionCall } from "#agent/core/contracts";

const ENVELOPE_BLOCK_REGEX = /```(yips-agent|yips-tools)\s*\n([\s\S]*?)```/gu;
const ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "list_dir",
  "grep",
  "run_command"
]);
const ALLOWED_SKILLS: ReadonlySet<SkillName> = new Set([
  "search",
  "fetch",
  "build",
  "todos",
  "virtual_terminal"
]);

interface EnvelopeRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is EnvelopeRecord {
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

function normalizeSkillCall(value: unknown): SkillCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const name = value["name"];
  const args = value["arguments"];

  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }
  if (typeof name !== "string" || !ALLOWED_SKILLS.has(name as SkillName)) {
    return null;
  }
  if (!isRecord(args)) {
    return null;
  }

  return {
    id: id.trim(),
    name: name as SkillName,
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
  const context =
    typeof contextRaw === "string" && contextRaw.trim().length > 0 ? contextRaw.trim() : undefined;

  const allowedToolsRaw = value["allowed_tools"];
  const allowedTools = Array.isArray(allowedToolsRaw)
    ? allowedToolsRaw.filter(
        (item): item is ToolName => typeof item === "string" && ALLOWED_TOOLS.has(item as ToolName)
      )
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

function dedupeActions(actions: AgentActionCall[], warnings: string[]): AgentActionCall[] {
  const seen = new Set<string>();
  const deduped: AgentActionCall[] = [];

  for (const action of actions) {
    const id = action.call.id;
    if (seen.has(id)) {
      warnings.push(`Duplicate action id '${id}' ignored.`);
      continue;
    }
    seen.add(id);
    deduped.push(action);
  }

  return deduped;
}

function parseLegacyActions(parsed: EnvelopeRecord): AgentActionCall[] {
  const actions: AgentActionCall[] = [];

  if (Array.isArray(parsed["tool_calls"])) {
    for (const value of parsed["tool_calls"]) {
      const call = normalizeToolCall(value);
      if (call) {
        actions.push({ kind: "tool", call });
      }
    }
  }

  if (Array.isArray(parsed["skill_calls"])) {
    for (const value of parsed["skill_calls"]) {
      const call = normalizeSkillCall(value);
      if (call) {
        actions.push({ kind: "skill", call });
      }
    }
  }

  if (Array.isArray(parsed["subagent_calls"])) {
    for (const value of parsed["subagent_calls"]) {
      const call = normalizeSubagentCall(value);
      if (call) {
        actions.push({ kind: "subagent", call });
      }
    }
  }

  return actions;
}

function parseAgentActions(parsed: EnvelopeRecord): AgentActionCall[] {
  const rawActions = parsed["actions"];
  if (!Array.isArray(rawActions)) {
    return [];
  }

  const actions: AgentActionCall[] = [];

  for (const entry of rawActions) {
    if (!isRecord(entry)) {
      continue;
    }

    const type = entry["type"];
    if (type === "tool") {
      const call = normalizeToolCall(entry);
      if (call) {
        actions.push({ kind: "tool", call });
      }
      continue;
    }

    if (type === "skill") {
      const call = normalizeSkillCall(entry);
      if (call) {
        actions.push({ kind: "skill", call });
      }
      continue;
    }

    if (type === "subagent") {
      const call = normalizeSubagentCall(entry);
      if (call) {
        actions.push({ kind: "subagent", call });
      }
    }
  }

  return actions;
}

function joinAssistantText(blocklessText: string, bodyText: string | null): string {
  const chunks = [blocklessText.trim(), bodyText?.trim() ?? ""].filter((chunk) => chunk.length > 0);
  return chunks.join("\n\n");
}

export interface ParsedAgentEnvelope {
  assistantText: string;
  actions: AgentActionCall[];
  warnings: string[];
  errors: string[];
  envelopeFound: boolean;
}

export function parseAgentEnvelope(input: string): ParsedAgentEnvelope {
  const matches = [...input.matchAll(ENVELOPE_BLOCK_REGEX)];

  if (matches.length === 0) {
    return {
      assistantText: input.trim(),
      actions: [],
      warnings: [],
      errors: [],
      envelopeFound: false
    };
  }

  if (matches.length > 1) {
    return {
      assistantText: input.trim(),
      actions: [],
      warnings: [],
      errors: ["Multiple action envelopes found; expected exactly one."],
      envelopeFound: true
    };
  }

  const match = matches[0];
  const blockType = (match?.[1] ?? "").trim();
  const jsonBody = (match?.[2] ?? "").trim();
  if (jsonBody.length === 0) {
    return {
      assistantText: input.replace(match?.[0] ?? "", "").trim(),
      actions: [],
      warnings: [],
      errors: ["Action envelope body is empty."],
      envelopeFound: true
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(jsonBody);
  } catch {
    return {
      assistantText: input.replace(match?.[0] ?? "", "").trim(),
      actions: [],
      warnings: [],
      errors: ["Action envelope JSON is invalid."],
      envelopeFound: true
    };
  }

  if (!isRecord(parsedUnknown)) {
    return {
      assistantText: input.replace(match?.[0] ?? "", "").trim(),
      actions: [],
      warnings: [],
      errors: ["Action envelope root must be a JSON object."],
      envelopeFound: true
    };
  }

  const parsed = parsedUnknown;
  const warnings: string[] = [];
  const textOutside = input.replace(match?.[0] ?? "", "").trim();
  const assistantTextInEnvelope =
    typeof parsed["assistant_text"] === "string" ? parsed["assistant_text"] : null;

  const actions =
    blockType === "yips-agent" ? parseAgentActions(parsed) : parseLegacyActions(parsed);

  return {
    assistantText: joinAssistantText(textOutside, assistantTextInEnvelope),
    actions: dedupeActions(actions, warnings),
    warnings,
    errors: [],
    envelopeFound: true
  };
}
