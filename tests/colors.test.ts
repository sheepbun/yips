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
  toHex
} from "../src/colors";

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
  it("wraps a character with truecolor markup", () => {
    const result = colorChar("A", { r: 255, g: 0, b: 128 });
    expect(result).toBe("^#ff0080A");
  });
});

describe("colorText", () => {
  it("wraps text with truecolor markup and reset", () => {
    const result = colorText("hello", { r: 255, g: 0, b: 0 });
    expect(result).toBe("^#ff0000hello^:");
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
    expect(result).toContain("^#");
    expect(result.endsWith("^:")).toBe(true);
  });

  it("applies gradient across multiple characters", () => {
    const result = horizontalGradient("ABC", GRADIENT_PINK, GRADIENT_YELLOW);
    // Should contain 3 color markers
    const colorMarkers = result.match(/\^#[0-9a-f]{6}/g);
    expect(colorMarkers).toHaveLength(3);
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
