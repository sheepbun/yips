import { describe, expect, it } from "vitest";

import { parseToolProtocol } from "../src/tool-protocol";

describe("tool-protocol", () => {
  it("parses valid yips-tools block", () => {
    const input = [
      "Working on it.",
      "```yips-tools",
      '{"tool_calls":[{"id":"1","name":"write_file","arguments":{"path":"README.md","content":"x"}}]}',
      "```"
    ].join("\n");

    const parsed = parseToolProtocol(input);
    expect(parsed.assistantText).toContain("Working on it.");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]?.name).toBe("write_file");
  });

  it("returns no tool calls on invalid json", () => {
    const parsed = parseToolProtocol("```yips-tools\nnot-json\n```");
    expect(parsed.toolCalls).toHaveLength(0);
  });

  it("ignores unknown tool names", () => {
    const input =
      '```yips-tools\n{"tool_calls":[{"id":"1","name":"unknown_tool","arguments":{}}]}\n```';
    const parsed = parseToolProtocol(input);
    expect(parsed.toolCalls).toHaveLength(0);
  });
});
