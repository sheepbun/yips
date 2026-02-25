import { describe, expect, it, vi } from "vitest";

import { runConductorTurn, type ConductorAssistantReply } from "../src/conductor";
import type { ChatMessage, ToolResult } from "../src/types";

function makeReply(
  text: string,
  overrides?: Partial<ConductorAssistantReply>
): ConductorAssistantReply {
  return {
    text,
    rendered: false,
    generationDurationMs: 1000,
    completionTokens: 10,
    ...overrides
  };
}

describe("runConductorTurn", () => {
  it("handles a no-tool assistant reply in one round", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];
    const onAssistantText = vi.fn();
    const onWarning = vi.fn();

    const result = await runConductorTurn({
      history,
      requestAssistant: vi.fn().mockResolvedValue(makeReply("Done.")),
      executeToolCalls: vi.fn(),
      onAssistantText,
      onWarning,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(42),
      computeTokensPerSecond: vi.fn().mockReturnValue(10)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(1);
    expect(onAssistantText).toHaveBeenCalledWith("Done.", false);
    expect(onWarning).not.toHaveBeenCalled();
    expect(history[history.length - 1]).toEqual({ role: "assistant", content: "Done." });
  });

  it("chains tool calls and feeds tool results back into history", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "inspect project" }];
    const executeToolCalls = vi.fn().mockResolvedValue([
      {
        callId: "c1",
        tool: "list_dir",
        status: "ok",
        output: "src\ntests"
      } as ToolResult
    ]);
    const onRoundComplete = vi.fn();

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Checking files.",
            "```yips-tools",
            '{"tool_calls":[{"id":"c1","name":"list_dir","arguments":{"path":"."}}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Found it."));

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls,
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      onRoundComplete,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(100),
      computeTokensPerSecond: vi.fn().mockReturnValue(20)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(2);
    expect(executeToolCalls).toHaveBeenCalledTimes(1);
    expect(onRoundComplete).toHaveBeenCalledTimes(1);
    expect(
      history.some((entry) => entry.role === "system" && entry.content.includes("Tool results:"))
    ).toBe(true);
    expect(history[history.length - 1]).toEqual({ role: "assistant", content: "Found it." });
  });

  it("continues after denied tool results and stops cleanly", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "delete file?" }];
    const executeToolCalls = vi.fn().mockResolvedValue([
      {
        callId: "rm1",
        tool: "run_command",
        status: "denied",
        output: "Action denied by user confirmation policy."
      } as ToolResult
    ]);

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Need approval first.",
            "```yips-tools",
            '{"tool_calls":[{"id":"rm1","name":"run_command","arguments":{"command":"rm -rf /tmp/x"}}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Understood, I will not run that."));

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls,
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(55),
      computeTokensPerSecond: vi.fn().mockReturnValue(11)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(2);
    expect(history.filter((entry) => entry.role === "system")).toHaveLength(1);
  });

  it("warns and stops when max depth is reached", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "loop tools" }];
    const onWarning = vi.fn();
    const requestAssistant = vi
      .fn()
      .mockResolvedValue(
        makeReply(
          [
            "Looping.",
            "```yips-tools",
            '{"tool_calls":[{"id":"c1","name":"list_dir","arguments":{"path":"."}}]}',
            "```"
          ].join("\n")
        )
      );

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls: vi.fn().mockResolvedValue([]),
      onAssistantText: vi.fn(),
      onWarning,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(999),
      computeTokensPerSecond: vi.fn().mockReturnValue(9),
      maxRounds: 2
    });

    expect(result.finished).toBe(false);
    expect(result.rounds).toBe(2);
    expect(onWarning).toHaveBeenCalledWith("Stopped tool chaining after max depth (6 rounds).");
  });

  it("injects automatic pivot guidance after consecutive failing tool rounds", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "do a risky thing" }];
    const onWarning = vi.fn();

    const failingResult: ToolResult = {
      callId: "c1",
      tool: "run_command",
      status: "error",
      output: "permission denied"
    };

    const executeToolCalls = vi
      .fn()
      .mockResolvedValueOnce([failingResult])
      .mockResolvedValueOnce([failingResult]);

    const toolResponse = makeReply(
      [
        "Trying tool.",
        "```yips-tools",
        '{"tool_calls":[{"id":"c1","name":"run_command","arguments":{"command":"x"}}]}',
        "```"
      ].join("\n")
    );

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(makeReply("Pivoted approach."));

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls,
      onAssistantText: vi.fn(),
      onWarning,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(50),
      computeTokensPerSecond: vi.fn().mockReturnValue(10),
      maxRounds: 4
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(3);
    expect(onWarning).toHaveBeenCalledWith(
      "Consecutive tool failures detected. Attempting an alternative approach."
    );
    expect(
      history.some(
        (entry) =>
          entry.role === "system" &&
          entry.content.startsWith("Automatic pivot: consecutive tool failures detected.")
      )
    ).toBe(true);
  });

  it("delegates subagent calls and injects results into history", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "analyze project quickly" }];
    const executeSubagentCalls = vi.fn().mockResolvedValue([
      {
        callId: "sa-1",
        status: "ok",
        output: "Subagent summary."
      }
    ]);

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Delegating scoped analysis.",
            "```yips-tools",
            '{"subagent_calls":[{"id":"sa-1","task":"summarize src"}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Integrated."));

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls: vi.fn(),
      executeSubagentCalls,
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(75),
      computeTokensPerSecond: vi.fn().mockReturnValue(10)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(2);
    expect(executeSubagentCalls).toHaveBeenCalledTimes(1);
    expect(
      history.some(
        (entry) => entry.role === "system" && entry.content.includes("Subagent results:")
      )
    ).toBe(true);
  });

  it("executes skill calls and injects skill results into history", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "find release notes" }];
    const executeSkillCalls = vi.fn().mockResolvedValue([
      {
        callId: "sk-1",
        skill: "search",
        status: "ok",
        output: "1. Release notes"
      }
    ]);

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Running skill.",
            "```yips-tools",
            '{"skill_calls":[{"id":"sk-1","name":"search","arguments":{"query":"release notes"}}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Done."));

    const result = await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls: vi.fn(),
      executeSkillCalls,
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(75),
      computeTokensPerSecond: vi.fn().mockReturnValue(10)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(2);
    expect(executeSkillCalls).toHaveBeenCalledTimes(1);
    expect(
      history.some((entry) => entry.role === "system" && entry.content.includes("Skill results:"))
    ).toBe(true);
  });

  it("warns and reports fallback results when skill runner is unavailable", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "do a search" }];
    const onWarning = vi.fn();
    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Trying skill.",
            "```yips-tools",
            '{"skill_calls":[{"id":"sk-1","name":"search","arguments":{"query":"test"}}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Unable to run skill."));

    await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls: vi.fn(),
      onAssistantText: vi.fn(),
      onWarning,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(70),
      computeTokensPerSecond: vi.fn().mockReturnValue(10)
    });

    expect(onWarning).toHaveBeenCalledWith(
      "Skill invocation requested, but no skill runner is configured."
    );
    expect(
      history.some(
        (entry) =>
          entry.role === "system" &&
          entry.content.includes('"status":"error"') &&
          entry.content.includes("Skill invocation is unavailable")
      )
    ).toBe(true);
  });

  it("warns and reports fallback results when subagent runner is unavailable", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "delegate this task" }];
    const onWarning = vi.fn();

    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce(
        makeReply(
          [
            "Delegating.",
            "```yips-tools",
            '{"subagent_calls":[{"id":"sa-1","task":"read docs"}]}',
            "```"
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(makeReply("Could not delegate."));

    await runConductorTurn({
      history,
      requestAssistant,
      executeToolCalls: vi.fn(),
      onAssistantText: vi.fn(),
      onWarning,
      estimateCompletionTokens: vi.fn().mockReturnValue(10),
      estimateHistoryTokens: vi.fn().mockReturnValue(70),
      computeTokensPerSecond: vi.fn().mockReturnValue(10)
    });

    expect(onWarning).toHaveBeenCalledWith(
      "Subagent delegation requested, but no subagent runner is configured."
    );
    expect(
      history.some(
        (entry) =>
          entry.role === "system" &&
          entry.content.includes('"status":"error"') &&
          entry.content.includes("Subagent delegation is unavailable")
      )
    ).toBe(true);
  });
});
