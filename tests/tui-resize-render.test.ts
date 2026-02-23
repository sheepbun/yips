import { describe, expect, it } from "vitest";

import { buildPromptBoxFrame } from "../src/prompt-box";
import { buildPromptComposerLayout } from "../src/prompt-composer";
import { buildPromptRenderLines, computeVisibleLayoutSlices } from "../src/tui";
import { stripMarkup } from "../src/title-box";

const INPUT_PINK_ANSI = "\u001b[38;2;255;204;255m";

describe("buildPromptRenderLines", () => {
  it("renders rounded prompt frame with prefix, content, and cursor", () => {
    const layout = buildPromptComposerLayout("hello", 5, 20, ">>> ");
    const lines = buildPromptRenderLines(22, "llama.cpp · qwen3", layout, true);
    const plain = lines.map(stripMarkup);

    const frame = buildPromptBoxFrame(22, "llama.cpp · qwen3", layout.rowCount);

    expect(lines).toHaveLength(layout.rowCount + 2);
    expect(lines[0]).toContain("\u001b[");
    expect(lines[1]).toContain(INPUT_PINK_ANSI);
    expect(plain[0]).toBe(frame.top);
    expect(plain[lines.length - 1]).toBe(frame.bottom);
    expect(plain[1]).toContain(">>> hello");
    expect(plain[1]).toContain("▌");
  });

  it("keeps vertical borders intact across wrapped prompt rows", () => {
    const text = "this text wraps across multiple prompt rows";
    const layout = buildPromptComposerLayout(text, Array.from(text).length, 10, ">>> ");
    const lines = buildPromptRenderLines(12, "llama.cpp · qwen3", layout, false);
    const plain = lines.map(stripMarkup);

    expect(plain.length).toBe(layout.rowCount + 2);

    const middleRows = plain.slice(1, -1);
    for (const row of middleRows) {
      expect(row.startsWith("│")).toBe(true);
      expect(row.endsWith("│")).toBe(true);
      expect(Array.from(row).length).toBe(12);
    }

    const coloredMiddleRows = lines.slice(1, -1);
    for (const row of coloredMiddleRows) {
      expect(row).toContain(INPUT_PINK_ANSI);
    }
  });

  it("clips status text in bottom border on narrow widths", () => {
    const layout = buildPromptComposerLayout("abc", 3, 8, ">>> ");
    const lines = buildPromptRenderLines(
      16,
      "llama.cpp · this-is-a-very-long-model-name",
      layout
    ).map(stripMarkup);

    expect(lines).toHaveLength(layout.rowCount + 2);
    expect(Array.from(lines[lines.length - 1] ?? "").length).toBe(16);
    expect(lines[lines.length - 1]?.startsWith("╰")).toBe(true);
    expect(lines[lines.length - 1]?.endsWith("╯")).toBe(true);
  });
});

describe("computeVisibleLayoutSlices", () => {
  it("keeps prompt anchored and uses upper stack tail when height is limited", () => {
    const title = ["title-1", "title-2"];
    const output = ["out-1", "out-2", "out-3", "out-4"];
    const prompt = ["prompt-1", "prompt-2", "prompt-3"];

    const visible = computeVisibleLayoutSlices(8, title, output, prompt);

    expect(visible.titleLines).toEqual(["title-2"]);
    expect(visible.outputLines).toEqual(["out-1", "out-2", "out-3", "out-4"]);
    expect(visible.promptLines).toEqual(["prompt-1", "prompt-2", "prompt-3"]);
  });

  it("allows output to push the title box off-screen", () => {
    const title = ["title-1", "title-2", "title-3"];
    const output = ["out-1", "out-2", "out-3", "out-4"];
    const prompt = ["prompt-1", "prompt-2"];

    const visible = computeVisibleLayoutSlices(6, title, output, prompt);

    expect(visible.titleLines).toEqual([]);
    expect(visible.outputLines).toEqual(["out-1", "out-2", "out-3", "out-4"]);
    expect(visible.promptLines).toEqual(["prompt-1", "prompt-2"]);
  });

  it("shows only prompt rows if prompt is taller than terminal height", () => {
    const title = ["title-1", "title-2"];
    const output = ["out-1", "out-2"];
    const prompt = ["prompt-1", "prompt-2", "prompt-3"];

    const visible = computeVisibleLayoutSlices(2, title, output, prompt);

    expect(visible.titleLines).toEqual([]);
    expect(visible.outputLines).toEqual([]);
    expect(visible.promptLines).toEqual(["prompt-2", "prompt-3"]);
  });

  it("pads above output so chat grows upward from prompt while title stays at top", () => {
    const title = ["title-1", "title-2"];
    const output = ["out-1"];
    const prompt = ["prompt-1", "prompt-2", "prompt-3"];

    const visible = computeVisibleLayoutSlices(10, title, output, prompt);

    expect(visible.titleLines).toEqual(["title-1", "title-2"]);
    expect(visible.outputLines).toEqual(["", "", "", "", "out-1"]);
    expect(visible.promptLines).toEqual(["prompt-1", "prompt-2", "prompt-3"]);
    expect(
      visible.titleLines.length + visible.outputLines.length + visible.promptLines.length
    ).toBe(10);
  });
});
