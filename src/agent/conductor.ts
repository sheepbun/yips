import { executeAgentActions } from "#agent/core/action-runner";
import { runAgentTurn } from "#agent/core/turn-engine";
import type {
  AgentAssistantReply,
  AgentTurnResult,
  AgentWarning
} from "#agent/core/contracts";
import type {
  ChatMessage,
  SkillCall,
  SkillResult,
  SubagentCall,
  SubagentResult,
  ToolCall,
  ToolResult
} from "#types/app-types";

export interface ConductorAssistantReply extends AgentAssistantReply {}

export interface ConductorDependencies {
  history: ChatMessage[];
  requestAssistant: () => Promise<ConductorAssistantReply>;
  executeToolCalls: (toolCalls: readonly ToolCall[]) => Promise<ToolResult[]>;
  executeSkillCalls?: (skillCalls: readonly SkillCall[]) => Promise<SkillResult[]>;
  executeSubagentCalls?: (subagentCalls: readonly SubagentCall[]) => Promise<SubagentResult[]>;
  onAssistantText: (assistantText: string, rendered: boolean) => void;
  onWarning: (message: string) => void;
  onRoundComplete?: () => void;
  estimateCompletionTokens: (text: string) => number;
  estimateHistoryTokens: (history: readonly ChatMessage[]) => number;
  computeTokensPerSecond: (tokens: number, durationMs: number) => number | null;
  maxRounds?: number;
}

export interface ConductorTurnResult extends AgentTurnResult {}

function forwardWarning(
  warning: AgentWarning,
  onWarning: ConductorDependencies["onWarning"]
): void {
  onWarning(warning.message);
}

export async function runConductorTurn(
  dependencies: ConductorDependencies
): Promise<ConductorTurnResult> {
  return await runAgentTurn({
    history: dependencies.history,
    requestAssistant: dependencies.requestAssistant,
    executeActions: async (actions) =>
      await executeAgentActions(actions, {
        executeToolCalls: dependencies.executeToolCalls,
        executeSkillCalls: dependencies.executeSkillCalls,
        executeSubagentCalls: dependencies.executeSubagentCalls,
        onWarning: (agentWarning) => {
          forwardWarning(agentWarning, dependencies.onWarning);
        }
      }),
    onAssistantText: dependencies.onAssistantText,
    onWarning: (agentWarning) => {
      forwardWarning(agentWarning, dependencies.onWarning);
    },
    onRoundComplete: dependencies.onRoundComplete,
    estimateCompletionTokens: dependencies.estimateCompletionTokens,
    estimateHistoryTokens: dependencies.estimateHistoryTokens,
    computeTokensPerSecond: dependencies.computeTokensPerSecond,
    maxRounds: dependencies.maxRounds
  });
}
