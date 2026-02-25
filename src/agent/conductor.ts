import { parseToolProtocol } from "#agent/protocol/tool-protocol";
import type {
  ChatMessage,
  SkillCall,
  SkillResult,
  SubagentCall,
  SubagentResult,
  ToolCall,
  ToolResult
} from "#types/app-types";

export interface ConductorAssistantReply {
  text: string;
  rendered: boolean;
  totalTokens?: number;
  completionTokens?: number;
  generationDurationMs?: number;
}

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

export interface ConductorTurnResult {
  finished: boolean;
  rounds: number;
  latestOutputTokensPerSecond: number | null;
  usedTokensExact: number | null;
}

const TOOL_FAILURE_STATUSES = new Set<ToolResult["status"]>(["error", "denied", "timeout"]);
const CONSECUTIVE_TOOL_FAILURE_PIVOT_THRESHOLD = 2;

function shouldCountAsFailureRound(toolResults: readonly ToolResult[]): boolean {
  if (toolResults.length === 0) {
    return false;
  }
  return toolResults.every((result) => TOOL_FAILURE_STATUSES.has(result.status));
}

export async function runConductorTurn(
  dependencies: ConductorDependencies
): Promise<ConductorTurnResult> {
  const maxRounds = dependencies.maxRounds ?? 6;
  let rounds = 0;
  let finished = false;
  let latestOutputTokensPerSecond: number | null = null;
  let usedTokensExact: number | null = null;
  let consecutiveFailureRounds = 0;

  while (!finished && rounds < maxRounds) {
    rounds += 1;
    const reply = await dependencies.requestAssistant();
    const parsed = parseToolProtocol(reply.text);
    const assistantText = parsed.assistantText.trim();

    if (assistantText.length > 0) {
      dependencies.onAssistantText(assistantText, reply.rendered);
      dependencies.history.push({ role: "assistant", content: assistantText });
    }

    const completionTokens =
      typeof reply.completionTokens === "number" && reply.completionTokens > 0
        ? reply.completionTokens
        : dependencies.estimateCompletionTokens(reply.text);
    latestOutputTokensPerSecond = dependencies.computeTokensPerSecond(
      completionTokens,
      reply.generationDurationMs ?? 0
    );

    usedTokensExact =
      typeof reply.totalTokens === "number" && reply.totalTokens >= 0
        ? reply.totalTokens
        : dependencies.estimateHistoryTokens(dependencies.history);

    if (
      parsed.toolCalls.length === 0 &&
      parsed.subagentCalls.length === 0 &&
      parsed.skillCalls.length === 0
    ) {
      finished = true;
      break;
    }

    if (parsed.toolCalls.length > 0) {
      const toolResults = await dependencies.executeToolCalls(parsed.toolCalls);
      dependencies.history.push({
        role: "system",
        content: `Tool results: ${JSON.stringify(toolResults)}`
      });
      if (shouldCountAsFailureRound(toolResults)) {
        consecutiveFailureRounds += 1;
        if (consecutiveFailureRounds >= CONSECUTIVE_TOOL_FAILURE_PIVOT_THRESHOLD) {
          dependencies.history.push({
            role: "system",
            content:
              "Automatic pivot: consecutive tool failures detected. Try a different approach, use different tools, or ask the user for clarification."
          });
          dependencies.onWarning(
            "Consecutive tool failures detected. Attempting an alternative approach."
          );
          consecutiveFailureRounds = 0;
        }
      } else {
        consecutiveFailureRounds = 0;
      }
    }

    if (parsed.skillCalls.length > 0) {
      if (!dependencies.executeSkillCalls) {
        dependencies.onWarning("Skill invocation requested, but no skill runner is configured.");
        const fallbackResults: SkillResult[] = parsed.skillCalls.map((call) => ({
          callId: call.id,
          skill: call.name,
          status: "error",
          output: "Skill invocation is unavailable in this runtime."
        }));
        dependencies.history.push({
          role: "system",
          content: `Skill results: ${JSON.stringify(fallbackResults)}`
        });
      } else {
        const skillResults = await dependencies.executeSkillCalls(parsed.skillCalls);
        dependencies.history.push({
          role: "system",
          content: `Skill results: ${JSON.stringify(skillResults)}`
        });
      }
    }

    if (parsed.subagentCalls.length > 0) {
      if (!dependencies.executeSubagentCalls) {
        dependencies.onWarning(
          "Subagent delegation requested, but no subagent runner is configured."
        );
        const fallbackResults: SubagentResult[] = parsed.subagentCalls.map((call) => ({
          callId: call.id,
          status: "error",
          output: "Subagent delegation is unavailable in this runtime."
        }));
        dependencies.history.push({
          role: "system",
          content: `Subagent results: ${JSON.stringify(fallbackResults)}`
        });
      } else {
        const subagentResults = await dependencies.executeSubagentCalls(parsed.subagentCalls);
        dependencies.history.push({
          role: "system",
          content: `Subagent results: ${JSON.stringify(subagentResults)}`
        });
      }
    }
    dependencies.onRoundComplete?.();
  }

  if (!finished) {
    dependencies.onWarning("Stopped tool chaining after max depth (6 rounds).");
  }

  return {
    finished,
    rounds,
    latestOutputTokensPerSecond,
    usedTokensExact
  };
}
