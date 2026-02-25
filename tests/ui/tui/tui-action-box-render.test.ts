import { describe, expect, it } from "vitest";

import { renderAssistantStreamForDisplay } from "#ui/tui/runtime-core";
import { stripMarkup } from "#ui/title-box";

describe("renderAssistantStreamForDisplay", () => {
  it("keeps normal assistant text when no envelope exists", () => {
    const rendered = renderAssistantStreamForDisplay(
      "Hello from assistant.",
      new Date(2026, 1, 25, 11, 40),
      false
    );
    const plain = stripMarkup(rendered);
    expect(plain).toContain("Yips: Hello from assistant.");
  });

  it("renders assistant prose and action call boxes for yips-agent envelopes", () => {
    const rendered = renderAssistantStreamForDisplay(
      [
        "```yips-agent",
        JSON.stringify({
          assistant_text: "Calling tool now",
          actions: [
            {
              type: "tool",
              id: "t1",
              name: "read_file",
              arguments: { path: "README.md" }
            }
          ]
        }),
        "```"
      ].join("\n"),
      new Date(2026, 1, 25, 11, 40),
      false
    );

    const plain = stripMarkup(rendered);
    expect(plain).toContain("Yips: Calling tool now");
    expect(plain).toContain("Tool Call");
    expect(plain).toContain("id: t1");
    expect(plain).toContain("name:");
    expect(plain).toContain("read_file");
    expect(plain).not.toContain("```yips-agent");
  });

  it("shows parse warning text for malformed envelopes", () => {
    const rendered = renderAssistantStreamForDisplay(
      "```yips-agent\nnot-json\n```",
      new Date(2026, 1, 25, 11, 40),
      false
    );

    const plain = stripMarkup(rendered);
    expect(plain).toContain("Tool protocol error:");
    expect(plain).not.toContain("```yips-agent");
  });
});
