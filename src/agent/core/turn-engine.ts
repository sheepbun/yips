import { parseAgentEnvelope } from "#agent/protocol/agent-envelope";

import type {
  AgentActionResult,
  AgentTurnRequest,
  AgentTurnResult,
  AgentWarning
} from "#agent/core/contracts";

const ACTION_FAILURE_STATUSES = new Set<AgentActionResult["status"]>(["error", "denied", "timeout"]);
const CONSECUTIVE_FAILURE_PIVOT_THRESHOLD = 2;

function shouldCountAsFailureRound(results: readonly AgentActionResult[]): boolean {
  if (results.length === 0) {
    return false;
  }
  return results.every((result) => ACTION_FAILURE_STATUSES.has(result.status));
}

function warning(code: string, message: string): AgentWarning {
  return { code, message };
}

function appendActionResultsToHistory(
  history: AgentTurnRequest["history"],
  actionResults: readonly AgentActionResult[]
): void {
  history.push({ role: "system", content: `Action results: ${JSON.stringify(actionResults)}` });

  const toolResults = actionResults
    .filter((result) => result.kind === "tool")
    .map((result) => ({
      callId: result.callId,
      tool: "unknown",
      status: result.status,
      output: result.output,
      metadata: result.metadata
    }));
  if (toolResults.length > 0) {
    history.push({ role: "system", content: `Tool results: ${JSON.stringify(toolResults)}` });
  }

  const skillResults = actionResults
    .filter((result) => result.kind === "skill")
    .map((result) => ({
      callId: result.callId,
      skill: "unknown",
      status: result.status,
      output: result.output,
      metadata: result.metadata
    }));
  if (skillResults.length > 0) {
    history.push({ role: "system", content: `Skill results: ${JSON.stringify(skillResults)}` });
  }

  const subagentResults = actionResults
    .filter((result) => result.kind === "subagent")
    .map((result) => ({
      callId: result.callId,
      status: result.status,
      output: result.output,
      metadata: result.metadata
    }));
  if (subagentResults.length > 0) {
    history.push({ role: "system", content: `Subagent results: ${JSON.stringify(subagentResults)}` });
  }
}

export async function runAgentTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
  const maxRounds = request.maxRounds ?? 6;
  let rounds = 0;
  let finished = false;
  let latestOutputTokensPerSecond: number | null = null;
  let usedTokensExact: number | null = null;
  let consecutiveFailureRounds = 0;

  while (!finished && rounds < maxRounds) {
    rounds += 1;
    const reply = await request.requestAssistant();
    const parsed = parseAgentEnvelope(reply.text);

    for (const parseWarning of parsed.warnings) {
      request.onWarning(warning("protocol_warning", parseWarning));
    }
    for (const parseError of parsed.errors) {
      request.onWarning(warning("protocol_parse_error", parseError));
      request.history.push({ role: "system", content: `Protocol parse error: ${parseError}` });
    }

    const assistantText = parsed.assistantText.trim();
    if (assistantText.length > 0) {
      request.onAssistantText(assistantText, reply.rendered);
      request.history.push({ role: "assistant", content: assistantText });
    }

    const completionTokens =
      typeof reply.completionTokens === "number" && reply.completionTokens > 0
        ? reply.completionTokens
        : request.estimateCompletionTokens(reply.text);
    latestOutputTokensPerSecond = request.computeTokensPerSecond(
      completionTokens,
      reply.generationDurationMs ?? 0
    );

    usedTokensExact =
      typeof reply.totalTokens === "number" && reply.totalTokens >= 0
        ? reply.totalTokens
        : request.estimateHistoryTokens(request.history);

    if (parsed.actions.length === 0) {
      finished = true;
      break;
    }

    const actionResults = await request.executeActions(parsed.actions);
    appendActionResultsToHistory(request.history, actionResults);

    if (shouldCountAsFailureRound(actionResults)) {
      consecutiveFailureRounds += 1;
      if (consecutiveFailureRounds >= CONSECUTIVE_FAILURE_PIVOT_THRESHOLD) {
        request.history.push({
          role: "system",
          content:
            "Automatic pivot: consecutive action failures detected. Try a different approach, use different tools, or ask the user for clarification."
        });
        request.onWarning(
          warning(
            "automatic_pivot",
            "Consecutive action failures detected. Attempting an alternative approach."
          )
        );
        consecutiveFailureRounds = 0;
      }
    } else {
      consecutiveFailureRounds = 0;
    }

    request.onRoundComplete?.();
  }

  if (!finished) {
    request.onWarning(warning("max_depth", `Stopped action chaining after max depth (${maxRounds} rounds).`));
  }

  return {
    finished,
    rounds,
    latestOutputTokensPerSecond,
    usedTokensExact
  };
}
