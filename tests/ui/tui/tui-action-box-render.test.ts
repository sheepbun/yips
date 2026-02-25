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

  it("renders assistant prose but not streamed action call previews for yips-agent envelopes", () => {
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
    expect(plain).not.toContain("● Read(README.md)");
    expect(plain).not.toContain("⎿ id: t1");
    expect(plain).not.toContain("queued for execution");
    expect(plain).not.toContain("Tool Call");
    expect(plain).not.toContain("╭");
    expect(plain).not.toContain("│");
    expect(plain).not.toContain("```yips-agent");
  });

  it("does not render streamed action previews in verbose mode either", () => {
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
      true
    );

    const plain = stripMarkup(rendered);
    expect(plain).toContain("Yips: Calling tool now");
    expect(plain).not.toContain("● Read(README.md)");
    expect(plain).not.toContain("⎿ id: t1");
    expect(plain).not.toContain("⎿ queued for execution");
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

  it("does not render partial envelope text while streaming", () => {
    const rendered = renderAssistantStreamForDisplay(
      "```yips-agent\n{\"actions\":[{\"type\":\"tool\"",
      new Date(2026, 1, 25, 11, 40),
      false
    );

    const plain = stripMarkup(rendered);
    expect(plain).toBe("");
    expect(plain).not.toContain("```yips-agent");
  });

  it("does not render grouped streamed call previews for multi-action envelopes", () => {
    const rendered = renderAssistantStreamForDisplay(
      [
        "```yips-agent",
        JSON.stringify({
          actions: [
            {
              type: "tool",
              id: "t1",
              name: "list_dir",
              arguments: { path: "." }
            },
            {
              type: "tool",
              id: "t2",
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
    expect(plain).not.toContain("● List(.)");
    expect(plain).not.toContain("● Read(README.md)");
  });

  it("keeps plain-text preview before envelope and converts to final assistant text when envelope completes", () => {
    const preview = renderAssistantStreamForDisplay(
      "Working on it...\n```yips-agent\n{\"actions\":[{\"type\":\"tool\"",
      new Date(2026, 1, 25, 11, 40),
      false
    );
    const previewPlain = stripMarkup(preview);
    expect(previewPlain).toContain("Yips: Working on it...");
    expect(previewPlain).not.toContain("```yips-agent");

    const finalRendered = renderAssistantStreamForDisplay(
      [
        "Working on it...",
        "```yips-agent",
        JSON.stringify({
          assistant_text: "Finished check. Running tool call now.",
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
    const finalPlain = stripMarkup(finalRendered);
    expect(finalPlain).toContain("Yips: Working on it...");
    expect(finalPlain).toContain("Finished check. Running tool call now.");
    expect(finalPlain).not.toContain("```yips-agent");
  });

  it("renders assistant_text from unfenced raw envelope JSON instead of dumping JSON", () => {
    const rendered = renderAssistantStreamForDisplay(
      JSON.stringify({
        assistant_text: "I found relevant files and can inspect one.",
        actions: [
          {
            type: "tool",
            id: "t1",
            name: "list_dir",
            arguments: { path: "." }
          }
        ]
      }),
      new Date(2026, 1, 25, 11, 40),
      false
    );

    const plain = stripMarkup(rendered);
    expect(plain).toContain("Yips: I found relevant files and can inspect one.");
    expect(plain).not.toContain("{\"assistant_text\"");
    expect(plain).not.toContain("\"actions\"");
  });
});
