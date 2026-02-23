import { describe, expect, it } from "vitest";

import { GRADIENT_PINK, GRADIENT_YELLOW, interpolateColor } from "../src/colors";
import { getLayoutMode, renderTitleBox, stripMarkup } from "../src/title-box";
import type { TitleBoxOptions } from "../src/title-box";

function makeOptions(overrides: Partial<TitleBoxOptions> = {}): TitleBoxOptions {
  return {
    width: 80,
    version: "0.1.0",
    username: "katherine",
    backend: "llamacpp",
    model: "qwen3",
    tokenUsage: "0/8192",
    cwd: "~/workspace/software/yips",
    sessionName: "test_session",
    ...overrides
  };
}

describe("getLayoutMode", () => {
  it("returns full for width >= 80", () => {
    expect(getLayoutMode(80)).toBe("full");
    expect(getLayoutMode(120)).toBe("full");
  });

  it("returns single for width 60-79", () => {
    expect(getLayoutMode(60)).toBe("single");
    expect(getLayoutMode(79)).toBe("single");
  });

  it("returns compact for width 45-59", () => {
    expect(getLayoutMode(45)).toBe("compact");
    expect(getLayoutMode(59)).toBe("compact");
  });

  it("returns minimal for width < 45", () => {
    expect(getLayoutMode(44)).toBe("minimal");
    expect(getLayoutMode(30)).toBe("minimal");
  });
});

describe("renderTitleBox", () => {
  it("renders full layout with two-column yips-cli content", () => {
    const lines = renderTitleBox(makeOptions({ width: 80 }));
    const plain = lines.map(stripMarkup);

    expect(plain[0]).toContain("Yips 0.1.0");
    expect(plain[0]).toContain("╭");
    expect(plain[0]).toContain("╮");

    const lastLine = plain[plain.length - 1]!;
    expect(lastLine).toContain("test session");
    expect(lastLine).toContain("╰");
    expect(lastLine).toContain("╯");

    const fullText = plain.join("\n");
    expect(fullText).toContain("Welcome back katherine!");
    expect(fullText).toContain("llamacpp");
    expect(fullText).toContain("Tips for getting started:");
    expect(fullText).toContain("Recent activity");
  });

  it("renders single layout with welcome and cwd", () => {
    const lines = renderTitleBox(makeOptions({ width: 65 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("Yips 0.1.0");
    expect(fullText).toContain("Welcome back katherine!");
    expect(fullText).toContain("llamacpp");
    expect(fullText).toContain("~/workspace/software/yips");
    expect(fullText).not.toContain("Tips for getting started:");
  });

  it("renders compact layout with short greeting", () => {
    const lines = renderTitleBox(makeOptions({ width: 50 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("Hi katherine!");
    expect(fullText).toContain("llamacpp");
    expect(fullText).not.toContain("~/workspace/software/yips");
  });

  it("renders minimal layout with model info", () => {
    const lines = renderTitleBox(makeOptions({ width: 40 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("Yips");
    expect(fullText).toContain("llamacpp");
    expect(fullText).not.toContain("Welcome back");
  });

  it("shows only provider when model is missing", () => {
    const lines = renderTitleBox(makeOptions({ width: 40, model: "", tokenUsage: "0/8192" }));
    const fullText = lines.map(stripMarkup).join("\n");

    expect(fullText).toContain("llamacpp");
    expect(fullText).not.toContain("0/8192");
    expect(fullText).not.toContain("llamacpp · ");
  });

  it("aligns right-column gradients to the outer title-box borders", () => {
    const width = 80;
    const lines = renderTitleBox(makeOptions({ width }));
    const plain = lines.map(stripMarkup);
    const tipsIndex = plain.findIndex((line) => line.includes("Tips for getting started:"));
    const recentIndex = plain.findIndex((line) => line.includes("Recent activity"));

    expect(tipsIndex).toBeGreaterThan(-1);
    expect(recentIndex).toBeGreaterThan(-1);

    const availableWidth = Math.max(0, width - 3);
    const leftWidth = Math.max(Math.floor(availableWidth * 0.45), 30);
    const rightStartColumn = leftWidth + 2;
    const maxColumn = Math.max(width - 1, 1);

    const expectedStart = interpolateColor(
      GRADIENT_PINK,
      GRADIENT_YELLOW,
      rightStartColumn / maxColumn
    );
    const expectedStartAnsi = `\u001b[38;2;${Math.round(expectedStart.r)};${Math.round(expectedStart.g)};${Math.round(expectedStart.b)}m`;

    const tipsMarkup = lines[tipsIndex] ?? "";
    const tipsColorAtRightStart = colorCodeBeforeColumn(tipsMarkup, rightStartColumn);
    expect(tipsColorAtRightStart).toBe(expectedStartAnsi);

    const dividerMarkup = lines[Math.max(0, recentIndex - 1)] ?? "";
    const dividerColorAtRightStart = colorCodeBeforeColumn(dividerMarkup, rightStartColumn);
    expect(dividerColorAtRightStart).toBe(expectedStartAnsi);
  });

  it("anchors welcome and cwd gradients to each string bounds", () => {
    const lines = renderTitleBox(makeOptions({ width: 65 }));
    const plain = lines.map(stripMarkup);

    const welcomeText = "Welcome back katherine!";
    const cwdText = "~/workspace/software/yips";
    const welcomeIndex = plain.findIndex((line) => line.includes(welcomeText));
    const cwdIndex = plain.findIndex((line) => line.includes(cwdText));

    expect(welcomeIndex).toBeGreaterThan(-1);
    expect(cwdIndex).toBeGreaterThan(-1);

    const expectedStartAnsi = toAnsiForeground(GRADIENT_PINK);
    const expectedEndAnsi = toAnsiForeground(GRADIENT_YELLOW);

    const welcomePlain = plain[welcomeIndex] ?? "";
    const welcomeStart = welcomePlain.indexOf(welcomeText);
    const welcomeEnd = welcomeStart + welcomeText.length - 1;
    expect(colorCodeBeforeColumn(lines[welcomeIndex] ?? "", welcomeStart)).toBe(expectedStartAnsi);
    expect(colorCodeBeforeColumn(lines[welcomeIndex] ?? "", welcomeEnd)).toBe(expectedEndAnsi);

    const cwdPlain = plain[cwdIndex] ?? "";
    const cwdStart = cwdPlain.indexOf(cwdText);
    const cwdEnd = cwdStart + cwdText.length - 1;
    expect(colorCodeBeforeColumn(lines[cwdIndex] ?? "", cwdStart)).toBe(expectedStartAnsi);
    expect(colorCodeBeforeColumn(lines[cwdIndex] ?? "", cwdEnd)).toBe(expectedEndAnsi);
  });

  it('renders "Recent activity" in white in full layout', () => {
    const lines = renderTitleBox(makeOptions({ width: 80 }));
    const plain = lines.map(stripMarkup);
    const recentIndex = plain.findIndex((line) => line.includes("Recent activity"));

    expect(recentIndex).toBeGreaterThan(-1);
    const recentPlain = plain[recentIndex] ?? "";
    const recentStart = recentPlain.indexOf("Recent activity");
    expect(colorCodeBeforeColumn(lines[recentIndex] ?? "", recentStart)).toBe(
      "\u001b[38;2;255;255;255m"
    );
  });
});

function colorCodeBeforeColumn(markupLine: string, plainColumn: number): string {
  const ansiRegex = /\u001b\[38;2;\d+;\d+;\d+m/g;
  let plainCount = 0;
  let activeColor = "";

  for (let i = 0; i < markupLine.length; i++) {
    const char = markupLine[i] ?? "";
    if (char === "\u001b") {
      ansiRegex.lastIndex = i;
      const match = ansiRegex.exec(markupLine);
      if (match !== null && match.index === i) {
        activeColor = match[0];
        i = ansiRegex.lastIndex - 1;
        continue;
      }

      const endIndex = markupLine.indexOf("m", i);
      if (endIndex >= 0) {
        i = endIndex;
      }
      continue;
    }

    if (plainCount === plainColumn) {
      return activeColor;
    }
    plainCount += 1;
  }

  return activeColor;
}

function toAnsiForeground(color: { r: number; g: number; b: number }): string {
  return `\u001b[38;2;${Math.round(color.r)};${Math.round(color.g)};${Math.round(color.b)}m`;
}

describe("stripMarkup", () => {
  it("removes terminal-kit color markup", () => {
    expect(stripMarkup("^[#ff1493]A^:")).toBe("A");
    expect(stripMarkup("^[#ff1493]H^[#ff3456]e^[#ff5619]l^:")).toBe("Hel");
  });

  it("removes ANSI SGR color sequences", () => {
    expect(stripMarkup("\u001b[38;2;255;20;147mA\u001b[39m")).toBe("A");
    expect(stripMarkup("\u001b[38;2;255;20;147mHi\u001b[39m")).toBe("Hi");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkup("hello")).toBe("hello");
  });
});
