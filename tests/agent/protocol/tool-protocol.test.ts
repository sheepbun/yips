import { describe, expect, it } from "vitest";

import { parseToolProtocol } from "#agent/protocol/tool-protocol";

describe("tool-protocol", () => {
  it("parses valid yips-tools block", () => {
    const input = [
      "Working on it.",
      "```yips-tools",
      '{"tool_calls":[{"id":"1","name":"preview_write_file","arguments":{"path":"README.md","content":"x"}}]}',
      "```"
    ].join("\n");

    const parsed = parseToolProtocol(input);
    expect(parsed.assistantText).toContain("Working on it.");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.subagentCalls).toHaveLength(0);
    expect(parsed.skillCalls).toHaveLength(0);
    expect(parsed.toolCalls[0]?.name).toBe("preview_write_file");
  });

  it("returns no tool calls on invalid json", () => {
    const parsed = parseToolProtocol("```yips-tools\nnot-json\n```");
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.subagentCalls).toHaveLength(0);
    expect(parsed.skillCalls).toHaveLength(0);
  });

  it("ignores unknown tool names", () => {
    const input =
      '```yips-tools\n{"tool_calls":[{"id":"1","name":"unknown_tool","arguments":{}}]}\n```';
    const parsed = parseToolProtocol(input);
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.skillCalls).toHaveLength(0);
  });

  it("parses valid subagent delegation calls", () => {
    const input = [
      "Delegating.",
      "```yips-tools",
      '{"subagent_calls":[{"id":"sa-1","task":"summarize src","context":"focus on exports","allowed_tools":["read_file","grep"],"max_rounds":3}]}',
      "```"
    ].join("\n");

    const parsed = parseToolProtocol(input);
    expect(parsed.subagentCalls).toHaveLength(1);
    expect(parsed.subagentCalls[0]).toEqual({
      id: "sa-1",
      task: "summarize src",
      context: "focus on exports",
      allowedTools: ["read_file", "grep"],
      maxRounds: 3
    });
    expect(parsed.skillCalls).toHaveLength(0);
  });

  it("parses valid skill calls", () => {
    const input = [
      "Use skills.",
      "```yips-tools",
      '{"skill_calls":[{"id":"sk-1","name":"search","arguments":{"query":"llama.cpp latest"}}]}',
      "```"
    ].join("\n");

    const parsed = parseToolProtocol(input);
    expect(parsed.skillCalls).toHaveLength(1);
    expect(parsed.skillCalls[0]).toEqual({
      id: "sk-1",
      name: "search",
      arguments: { query: "llama.cpp latest" }
    });
  });
});
