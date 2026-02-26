import { describe, expect, it } from "vitest";

import { composeFullTranscriptLines } from "#ui/tui/runtime-core";

describe("composeFullTranscriptLines", () => {
  it("keeps title first, then output, then prompt", () => {
    const lines = composeFullTranscriptLines({
      titleLines: ["title-1", "title-2"],
      outputLines: ["chat-1", "chat-2"],
      promptLines: ["prompt-1", "prompt-2"]
    });

    expect(lines).toEqual(["title-1", "title-2", "chat-1", "chat-2", "prompt-1", "prompt-2"]);
  });

  it("includes all lines without viewport cropping", () => {
    const lines = composeFullTranscriptLines({
      titleLines: ["title"],
      outputLines: Array.from({ length: 120 }, (_, index) => `line-${index + 1}`),
      promptLines: ["prompt"]
    });

    expect(lines[0]).toBe("title");
    expect(lines).toContain("line-1");
    expect(lines).toContain("line-120");
    expect(lines[lines.length - 1]).toBe("prompt");
    expect(lines).toHaveLength(122);
  });
});
