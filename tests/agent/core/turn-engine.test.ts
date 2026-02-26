import { describe, expect, it, vi } from "vitest";

import { runAgentTurn } from "#agent/core/turn-engine";
import type { ChatMessage } from "#types/app-types";

describe("turn-engine", () => {
  it("finishes in one round when there are no actions", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];

    const result = await runAgentTurn({
      history,
      requestAssistant: async () => ({
        text: "No actions needed.",
        rendered: false,
        completionTokens: 5,
        generationDurationMs: 1000
      }),
      executeActions: vi.fn(async () => []),
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn(() => 5),
      estimateHistoryTokens: vi.fn(() => 10),
      computeTokensPerSecond: vi.fn(() => 5)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(1);
  });

  it("chains actions across rounds", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "inspect" }];
    const requestAssistant = vi
      .fn()
      .mockResolvedValueOnce({
        text: [
          "Run tool",
          "```yips-agent",
          '{"actions":[{"type":"tool","id":"t1","name":"list_dir","arguments":{"path":"."}}]}',
          "```"
        ].join("\n"),
        rendered: false,
        completionTokens: 5,
        generationDurationMs: 1000
      })
      .mockResolvedValueOnce({
        text: "Done.",
        rendered: false,
        completionTokens: 5,
        generationDurationMs: 1000
      });

    const executeActions = vi.fn(async () => [
      {
        kind: "tool" as const,
        callId: "t1",
        status: "ok" as const,
        output: "src"
      }
    ]);

    const result = await runAgentTurn({
      history,
      requestAssistant,
      executeActions,
      onAssistantText: vi.fn(),
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn(() => 5),
      estimateHistoryTokens: vi.fn(() => 10),
      computeTokensPerSecond: vi.fn(() => 5)
    });

    expect(result.finished).toBe(true);
    expect(result.rounds).toBe(2);
    expect(executeActions).toHaveBeenCalledTimes(1);
    expect(history.some((entry) => entry.content.startsWith("Action results:"))).toBe(true);
  });

  it("warns after parse error and stops", async () => {
    const onWarning = vi.fn();

    const result = await runAgentTurn({
      history: [{ role: "user", content: "x" }],
      requestAssistant: async () => ({
        text: "```yips-agent\nnot-json\n```",
        rendered: false,
        completionTokens: 3,
        generationDurationMs: 1000
      }),
      executeActions: vi.fn(async () => []),
      onAssistantText: vi.fn(),
      onWarning,
      estimateCompletionTokens: vi.fn(() => 3),
      estimateHistoryTokens: vi.fn(() => 7),
      computeTokensPerSecond: vi.fn(() => 3)
    });

    expect(result.finished).toBe(true);
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({ code: "protocol_parse_error" })
    );
  });

  it("emits fallback assistant text when reply is blank and has no actions", async () => {
    const onAssistantText = vi.fn();
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];

    const result = await runAgentTurn({
      history,
      requestAssistant: async () => ({
        text: "   ",
        rendered: false,
        completionTokens: 1,
        generationDurationMs: 1000
      }),
      executeActions: vi.fn(async () => []),
      onAssistantText,
      onWarning: vi.fn(),
      estimateCompletionTokens: vi.fn(() => 1),
      estimateHistoryTokens: vi.fn(() => 2),
      computeTokensPerSecond: vi.fn(() => 1)
    });

    expect(result.finished).toBe(true);
    expect(onAssistantText).toHaveBeenCalledWith("(no response)", false);
    expect(history[history.length - 1]).toEqual({
      role: "assistant",
      content: "(no response)"
    });
  });
});
