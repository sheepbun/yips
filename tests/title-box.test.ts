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
  it("renders full layout with two-column yips-cli content", () => {
    const lines = renderTitleBox(makeOptions({ width: 80 }));
    const plain = lines.map(stripMarkup);

    expect(plain[0]).toContain("Yips CLI 0.1.0");
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

    expect(fullText).toContain("Yips CLI 0.1.0");
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

    expect(fullText).toContain("Yips CLI");
    expect(fullText).toContain("llamacpp");
    expect(fullText).not.toContain("Welcome back");
  });
});

describe("stripMarkup", () => {
  it("removes terminal-kit color markup", () => {
    expect(stripMarkup("^[#ff1493]A^:")).toBe("A");
    expect(stripMarkup("^[#ff1493]H^[#ff3456]e^[#ff5619]l^:")).toBe("Hel");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkup("hello")).toBe("hello");
  });
});
