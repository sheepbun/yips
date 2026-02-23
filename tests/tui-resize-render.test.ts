import { describe, expect, it } from "vitest";

import { buildPromptBoxFrame } from "../src/prompt-box";
import { buildPromptComposerLayout } from "../src/prompt-composer";
import { buildPromptRenderLines } from "../src/tui";
import { stripMarkup } from "../src/title-box";

describe("buildPromptRenderLines", () => {
  it("renders rounded prompt frame with prefix, content, and cursor", () => {
    const layout = buildPromptComposerLayout("hello", 5, 20, ">>> ");
    const lines = buildPromptRenderLines(22, "llama.cpp · qwen3", layout, true);
    const plain = lines.map(stripMarkup);

    const frame = buildPromptBoxFrame(22, "llama.cpp · qwen3", layout.rowCount);

    expect(lines).toHaveLength(layout.rowCount + 2);
    expect(lines[0]).toContain("\u001b[");
    expect(plain[0]).toBe(frame.top);
    expect(plain[lines.length - 1]).toBe(frame.bottom);
    expect(plain[1]).toContain(">>> hello");
    expect(plain[1]).toContain("▌");
  });

  it("keeps vertical borders intact across wrapped prompt rows", () => {
    const text = "this text wraps across multiple prompt rows";
    const layout = buildPromptComposerLayout(text, Array.from(text).length, 10, ">>> ");
    const lines = buildPromptRenderLines(12, "llama.cpp · qwen3", layout, false).map(stripMarkup);

    expect(lines.length).toBe(layout.rowCount + 2);

    const middleRows = lines.slice(1, -1);
    for (const row of middleRows) {
      expect(row.startsWith("│")).toBe(true);
      expect(row.endsWith("│")).toBe(true);
      expect(Array.from(row).length).toBe(12);
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
