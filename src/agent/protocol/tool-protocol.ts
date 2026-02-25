import { parseAgentEnvelope } from "#agent/protocol/agent-envelope";
import type { SkillCall, SubagentCall, ToolCall } from "#types/app-types";

export interface ParsedToolProtocol {
  assistantText: string;
  toolCalls: ToolCall[];
  subagentCalls: SubagentCall[];
  skillCalls: SkillCall[];
}

export function parseToolProtocol(input: string): ParsedToolProtocol {
  const parsed = parseAgentEnvelope(input);

  return {
    assistantText: parsed.assistantText,
    toolCalls: parsed.actions.filter((action): action is { kind: "tool"; call: ToolCall } => action.kind === "tool").map((action) => action.call),
    subagentCalls: parsed.actions
      .filter((action): action is { kind: "subagent"; call: SubagentCall } => action.kind === "subagent")
      .map((action) => action.call),
    skillCalls: parsed.actions
      .filter((action): action is { kind: "skill"; call: SkillCall } => action.kind === "skill")
      .map((action) => action.call)
  };
}
