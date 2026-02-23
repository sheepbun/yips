import { describe, expect, it } from "vitest";

import { buildPromptBoxFrame, buildPromptBoxLayout } from "../src/prompt-box";

function charLength(text: string): number {
  return Array.from(text).length;
}

function getInner(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 2) return "";
  return chars.slice(1, -1).join("");
}

describe("buildPromptBoxLayout", () => {
  it("builds rounded prompt box lines with fixed width", () => {
    const layout = buildPromptBoxLayout(24, "llama.cpp · qwen3");

    expect(charLength(layout.top)).toBe(24);
    expect(charLength(layout.middle)).toBe(24);
    expect(charLength(layout.bottom)).toBe(24);
    expect(layout.top.startsWith("╭")).toBe(true);
    expect(layout.top.endsWith("╮")).toBe(true);
    expect(layout.middle.startsWith("│")).toBe(true);
    expect(layout.middle.endsWith("│")).toBe(true);
    expect(layout.bottom.startsWith("╰")).toBe(true);
    expect(layout.bottom.endsWith("╯")).toBe(true);
  });

  it("right-aligns status text inside bottom border", () => {
    const status = "llama.cpp · qwen3";
    const layout = buildPromptBoxLayout(32, status);
    const inner = getInner(layout.bottom);

    expect(inner.endsWith(` ${status} `)).toBe(true);
    expect(inner.startsWith("─")).toBe(true);
  });

  it("clips oversized status text to stay within the bottom border", () => {
    const status = "llama.cpp · really-long-model-name";
    const layout = buildPromptBoxLayout(12, status);
    const inner = getInner(layout.bottom);
    const expected = Array.from(` ${status} `).slice(-layout.innerWidth).join("");

    expect(charLength(inner)).toBe(layout.innerWidth);
    expect(inner).toBe(expected);
  });

  it("keeps a valid box shape on very narrow widths", () => {
    expect(buildPromptBoxLayout(2, "x")).toEqual({
      top: "╭╮",
      middle: "││",
      bottom: "╰╯",
      innerWidth: 0,
      prompt: "",
      promptPadding: ""
    });

    expect(buildPromptBoxLayout(1, "x")).toEqual({
      top: "╭",
      middle: "│",
      bottom: "╰",
      innerWidth: 0,
      prompt: "",
      promptPadding: ""
    });
  });

  it("clips prompt prefix for narrow middle rows", () => {
    const layout = buildPromptBoxLayout(4, "ok", ">>> ");

    expect(layout.prompt).toBe(">>");
    expect(layout.promptPadding).toBe("");
    expect(layout.middle).toBe("│>>│");
  });
});

describe("buildPromptBoxFrame", () => {
  it("builds the requested number of middle rows", () => {
    const frame = buildPromptBoxFrame(20, "llama.cpp · qwen3", 3);

    expect(frame.middleRows).toHaveLength(3);
    for (const row of frame.middleRows) {
      expect(charLength(row)).toBe(20);
      expect(row.startsWith("│")).toBe(true);
      expect(row.endsWith("│")).toBe(true);
    }
  });

  it("clips status from the left when space is tight", () => {
    const frame = buildPromptBoxFrame(12, "llama.cpp · very-long-model", 1);
    const inner = getInner(frame.bottom);

    expect(charLength(inner)).toBe(frame.innerWidth);
    expect(inner).toBe(
      Array.from(" llama.cpp · very-long-model ").slice(-frame.innerWidth).join("")
    );
  });
});
