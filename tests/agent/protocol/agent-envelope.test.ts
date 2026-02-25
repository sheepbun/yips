import { describe, expect, it } from "vitest";

import { parseAgentEnvelope } from "#agent/protocol/agent-envelope";

describe("agent-envelope", () => {
  it("parses strict yips-agent envelope with mixed actions", () => {
    const parsed = parseAgentEnvelope([
      "Working on it.",
      "```yips-agent",
      JSON.stringify({
        assistant_text: "Delegating + searching.",
        actions: [
          {
            type: "tool",
            id: "t1",
            name: "read_file",
            arguments: { path: "README.md" }
          },
          {
            type: "skill",
            id: "s1",
            name: "search",
            arguments: { query: "yips roadmap" }
          },
          {
            type: "subagent",
            id: "a1",
            task: "summarize docs",
            allowed_tools: ["read_file"],
            max_rounds: 2
          }
        ]
      }),
      "```"
    ].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.actions).toHaveLength(3);
    expect(parsed.assistantText).toContain("Working on it.");
    expect(parsed.assistantText).toContain("Delegating + searching.");
  });

  it("reports malformed json", () => {
    const parsed = parseAgentEnvelope("```yips-agent\nnot-json\n```");
    expect(parsed.errors).toContain("Action envelope JSON is invalid.");
    expect(parsed.actions).toHaveLength(0);
  });

  it("dedupes duplicate action ids with warning", () => {
    const parsed = parseAgentEnvelope([
      "```yips-agent",
      JSON.stringify({
        actions: [
          {
            type: "tool",
            id: "dup",
            name: "read_file",
            arguments: { path: "a" }
          },
          {
            type: "tool",
            id: "dup",
            name: "read_file",
            arguments: { path: "b" }
          }
        ]
      }),
      "```"
    ].join("\n"));

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.warnings).toContain("Duplicate action id 'dup' ignored.");
  });

  it("keeps legacy yips-tools compatibility", () => {
    const parsed = parseAgentEnvelope([
      "```yips-tools",
      '{"tool_calls":[{"id":"1","name":"list_dir","arguments":{"path":"."}}]}',
      "```"
    ].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.kind).toBe("tool");
  });
});
