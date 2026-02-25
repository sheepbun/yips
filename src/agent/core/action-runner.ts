import type { SkillCall, SkillResult, SubagentCall, SubagentResult, ToolCall, ToolResult } from "#types/app-types";

import {
  type AgentActionCall,
  type AgentActionResult,
  type AgentWarning,
  toAgentSkillResult,
  toAgentSubagentResult,
  toAgentToolResult
} from "#agent/core/contracts";

export interface ActionRunnerDependencies {
  executeToolCalls: (toolCalls: readonly ToolCall[]) => Promise<ToolResult[]>;
  executeSkillCalls?: (skillCalls: readonly SkillCall[]) => Promise<SkillResult[]>;
  executeSubagentCalls?: (subagentCalls: readonly SubagentCall[]) => Promise<SubagentResult[]>;
  onWarning?: (warning: AgentWarning) => void;
}

function missingRunnerResult(action: AgentActionCall): AgentActionResult {
  if (action.kind === "skill") {
    return {
      kind: "skill",
      callId: action.call.id,
      status: "error",
      output: "Skill invocation is unavailable in this runtime."
    };
  }

  return {
    kind: "subagent",
    callId: action.call.id,
    status: "error",
    output: "Subagent delegation is unavailable in this runtime."
  };
}

function missingRunnerWarning(action: AgentActionCall): AgentWarning {
  if (action.kind === "skill") {
    return {
      code: "skill_runner_unavailable",
      message: "Skill invocation requested, but no skill runner is configured."
    };
  }

  return {
    code: "subagent_runner_unavailable",
    message: "Subagent delegation requested, but no subagent runner is configured."
  };
}

export async function executeAgentActions(
  actions: readonly AgentActionCall[],
  dependencies: ActionRunnerDependencies
): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];

  for (const action of actions) {
    if (action.kind === "tool") {
      const toolResults = await dependencies.executeToolCalls([action.call]);
      const result = toolResults[0];
      if (!result) {
        results.push({
          kind: "tool",
          callId: action.call.id,
          status: "error",
          output: `Tool call '${action.call.id}' produced no result.`
        });
        continue;
      }
      results.push(toAgentToolResult(result));
      continue;
    }

    if (action.kind === "skill") {
      if (!dependencies.executeSkillCalls) {
        dependencies.onWarning?.(missingRunnerWarning(action));
        results.push(missingRunnerResult(action));
        continue;
      }
      const skillResults = await dependencies.executeSkillCalls([action.call]);
      const result = skillResults[0];
      if (!result) {
        results.push({
          kind: "skill",
          callId: action.call.id,
          status: "error",
          output: `Skill call '${action.call.id}' produced no result.`
        });
        continue;
      }
      results.push(toAgentSkillResult(result));
      continue;
    }

    if (!dependencies.executeSubagentCalls) {
      dependencies.onWarning?.(missingRunnerWarning(action));
      results.push(missingRunnerResult(action));
      continue;
    }
    const subagentResults = await dependencies.executeSubagentCalls([action.call]);
    const result = subagentResults[0];
    if (!result) {
      results.push({
        kind: "subagent",
        callId: action.call.id,
        status: "error",
        output: `Subagent call '${action.call.id}' produced no result.`
      });
      continue;
    }
    results.push(toAgentSubagentResult(result));
  }

  return results;
}
