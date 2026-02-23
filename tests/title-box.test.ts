import { describe, expect, it } from "vitest";

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
  it("renders full layout with logo and info", () => {
    const lines = renderTitleBox(makeOptions({ width: 80 }));
    const plain = lines.map(stripMarkup);

    expect(plain[0]).toContain("Yips CLI v0.1.0");
    expect(plain[0]).toContain("╭");
    expect(plain[0]).toContain("╮");

    const lastLine = plain[plain.length - 1]!;
    expect(lastLine).toContain("test_session");
    expect(lastLine).toContain("╰");
    expect(lastLine).toContain("╯");

    const fullText = plain.join("\n");
    expect(fullText).toContain("Welcome, katherine!");
    expect(fullText).toContain("llamacpp");
  });

  it("renders single layout without info panel", () => {
    const lines = renderTitleBox(makeOptions({ width: 65 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("Yips CLI v0.1.0");
    expect(fullText).toContain("llamacpp");
    expect(fullText).not.toContain("Welcome");
  });

  it("renders compact layout with text title", () => {
    const lines = renderTitleBox(makeOptions({ width: 50 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("YIPS");
    expect(fullText).toContain("llamacpp");
  });

  it("renders minimal layout", () => {
    const lines = renderTitleBox(makeOptions({ width: 40 }));
    const plain = lines.map(stripMarkup);
    const fullText = plain.join("\n");

    expect(fullText).toContain("YIPS");
    expect(lines.length).toBeLessThanOrEqual(4);
  });
});

describe("stripMarkup", () => {
  it("removes terminal-kit color markup", () => {
    expect(stripMarkup("^#ff1493A^:")).toBe("A");
    expect(stripMarkup("^#ff1493H^#ff3456e^#ff5619l^:")).toBe("Hel");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkup("hello")).toBe("hello");
  });
});
