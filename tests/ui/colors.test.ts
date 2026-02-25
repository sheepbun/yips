import { describe, expect, it } from "vitest";

import {
  colorChar,
  colorText,
  diagonalGradient,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  interpolateColor,
  parseHex,
  rowMajorGradient,
  toHex
} from "#ui/colors";

describe("parseHex", () => {
  it("parses a hex color with hash", () => {
    expect(parseHex("#FF1493")).toEqual({ r: 255, g: 20, b: 147 });
  });

  it("parses a hex color without hash", () => {
    expect(parseHex("FFE135")).toEqual({ r: 255, g: 225, b: 53 });
  });
});

describe("toHex", () => {
  it("converts RGB to hex string", () => {
    expect(toHex({ r: 255, g: 20, b: 147 })).toBe("#ff1493");
  });

  it("clamps values to 0-255", () => {
    expect(toHex({ r: 300, g: -10, b: 128 })).toBe("#ff0080");
  });
});

describe("interpolateColor", () => {
  it("returns start color at t=0", () => {
    const result = interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, 0);
    expect(result.r).toBe(GRADIENT_PINK.r);
    expect(result.g).toBe(GRADIENT_PINK.g);
    expect(result.b).toBe(GRADIENT_PINK.b);
  });

  it("returns end color at t=1", () => {
    const result = interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, 1);
    expect(result.r).toBe(GRADIENT_YELLOW.r);
    expect(result.g).toBe(GRADIENT_YELLOW.g);
    expect(result.b).toBe(GRADIENT_YELLOW.b);
  });

  it("returns midpoint at t=0.5", () => {
    const result = interpolateColor({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 50 }, 0.5);
    expect(result.r).toBe(50);
    expect(result.g).toBe(100);
    expect(result.b).toBe(25);
  });

  it("clamps t to [0, 1]", () => {
    const start = { r: 0, g: 0, b: 0 };
    const end = { r: 100, g: 100, b: 100 };
    expect(interpolateColor(start, end, -1)).toEqual(start);
    expect(interpolateColor(start, end, 2)).toEqual(end);
  });
});

describe("colorChar", () => {
  it("wraps a character with ANSI truecolor", () => {
    const result = colorChar("A", { r: 255, g: 0, b: 128 });
    expect(result).toBe("\u001b[38;2;255;0;128mA");
  });
});

describe("colorText", () => {
  it("wraps text with ANSI truecolor and foreground reset", () => {
    const result = colorText("hello", { r: 255, g: 0, b: 0 });
    expect(result).toBe("\u001b[38;2;255;0;0mhello\u001b[39m");
  });

  it("returns empty string for empty input", () => {
    expect(colorText("", { r: 0, g: 0, b: 0 })).toBe("");
  });
});

describe("horizontalGradient", () => {
  it("returns empty string for empty input", () => {
    expect(horizontalGradient("", GRADIENT_PINK, GRADIENT_YELLOW)).toBe("");
  });

  it("handles single character", () => {
    const result = horizontalGradient("A", GRADIENT_PINK, GRADIENT_YELLOW);
    expect(result).toContain("A");
    expect(result).toContain("\u001b[38;2;");
    expect(result.endsWith("\u001b[39m")).toBe(true);
  });

  it("applies gradient across multiple characters", () => {
    const result = horizontalGradient("ABC", GRADIENT_PINK, GRADIENT_YELLOW);
    // Should contain 3 color markers
    const markerCount = result.split("\u001b[38;2;").length - 1;
    expect(markerCount).toBe(3);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });
});

describe("diagonalGradient", () => {
  it("returns empty array for empty input", () => {
    expect(diagonalGradient([], GRADIENT_PINK, GRADIENT_YELLOW)).toEqual([]);
  });

  it("handles lines of different lengths", () => {
    const result = diagonalGradient(["AB", "ABCD"], GRADIENT_PINK, GRADIENT_YELLOW);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("A");
    expect(result[1]).toContain("D");
  });

  it("handles empty lines within the array", () => {
    const result = diagonalGradient(["AB", "", "CD"], GRADIENT_PINK, GRADIENT_YELLOW);
    expect(result).toHaveLength(3);
    expect(result[1]).toBe("");
  });
});

describe("rowMajorGradient", () => {
  it("returns empty array for empty input", () => {
    expect(rowMajorGradient([], GRADIENT_PINK, GRADIENT_YELLOW)).toEqual([]);
  });

  it("handles lines of different lengths", () => {
    const result = rowMajorGradient(["AB", "ABCD"], GRADIENT_PINK, GRADIENT_YELLOW);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("A");
    expect(result[1]).toContain("D");
  });

  it("anchors first and last cells to gradient endpoints", () => {
    const result = rowMajorGradient(["AB", "CD"], GRADIENT_PINK, GRADIENT_YELLOW);
    expect(colorCodeBeforeColumn(result[0] ?? "", 0)).toBe(toAnsiForeground(GRADIENT_PINK));
    expect(colorCodeBeforeColumn(result[1] ?? "", 1)).toBe(toAnsiForeground(GRADIENT_YELLOW));
  });

  it("continues progression from one row to the next", () => {
    const result = rowMajorGradient(["AB", "CD"], GRADIENT_PINK, GRADIENT_YELLOW);
    const bColor = colorCodeBeforeColumn(result[0] ?? "", 1);
    const cColor = colorCodeBeforeColumn(result[1] ?? "", 0);

    expect(bColor).not.toBe("");
    expect(cColor).not.toBe("");
    expect(cColor).not.toBe(toAnsiForeground(GRADIENT_PINK));
    expect(cColor).not.toBe(bColor);
  });
});

function colorCodeBeforeColumn(markupLine: string, plainColumn: number): string {
  let plainCount = 0;
  let activeColor = "";

  for (let i = 0; i < markupLine.length; i++) {
    const char = markupLine[i] ?? "";
    if (char === "\u001b") {
      const endIndex = markupLine.indexOf("m", i);
      if (endIndex >= 0) {
        if (markupLine.startsWith("\u001b[38;2;", i)) {
          activeColor = markupLine.slice(i, endIndex + 1);
        }
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
