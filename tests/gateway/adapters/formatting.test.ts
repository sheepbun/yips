import { describe, expect, it } from "vitest";

import {
  chunkOutboundText,
  normalizeOutboundText,
  sanitizeMentions,
  stripCommonMarkdown
} from "#gateway/adapters/formatting";

describe("gateway adapter formatting helpers", () => {
  it("strips common markdown while preserving text content", () => {
    const input = "```ts\nconst x = 1;\n```\n**bold** _italic_ ~~gone~~ and `code`";
    expect(stripCommonMarkdown(input)).toBe("const x = 1;\nbold italic gone and code");
  });

  it("sanitizes mention tokens to avoid accidental pings", () => {
    const output = sanitizeMentions("@everyone @here hi @alice and <@12345>.");
    expect(output).toContain("@\u200Beveryone");
    expect(output).toContain("@\u200Bhere");
    expect(output).toContain("@\u200Balice");
    expect(output).toContain("<@\u200B12345>");
  });

  it("normalizes line endings and collapses excessive blank lines", () => {
    const input = "  line1\r\n\r\n\r\nline2\rline3  ";
    expect(normalizeOutboundText(input)).toBe("line1\n\nline2\nline3");
  });

  it("chunks by boundary and hard-splits oversized tokens", () => {
    expect(chunkOutboundText("alpha beta gamma delta", 12)).toEqual(["alpha beta", "gamma delta"]);
    expect(chunkOutboundText("abcdefghijklmnopqrstuvwxyz", 10)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });
});
