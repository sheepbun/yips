import { describe, expect, it } from "vitest";

import { InputEngine, parseCsiSequence } from "#ui/input/input-engine";

describe("parseCsiSequence", () => {
  it("maps modified and unmodified enter sequences", () => {
    expect(parseCsiSequence("\x1b[13u")).toEqual({ type: "submit" });
    expect(parseCsiSequence("\x1b[13;1u")).toEqual({ type: "submit" });
    expect(parseCsiSequence("\x1b[13;5u")).toEqual({ type: "newline" });
    expect(parseCsiSequence("\x1b[13;5~")).toEqual({ type: "newline" });
    expect(parseCsiSequence("\x1b[1;5M")).toEqual({ type: "newline" });
    expect(parseCsiSequence("\x1b[27;13;5~")).toEqual({ type: "newline" });
  });

  it("maps navigation and edit CSI sequences", () => {
    expect(parseCsiSequence("\x1b[A")).toEqual({ type: "move-up" });
    expect(parseCsiSequence("\x1b[B")).toEqual({ type: "move-down" });
    expect(parseCsiSequence("\x1b[C")).toEqual({ type: "move-right" });
    expect(parseCsiSequence("\x1b[D")).toEqual({ type: "move-left" });
    expect(parseCsiSequence("\x1b[H")).toEqual({ type: "home" });
    expect(parseCsiSequence("\x1b[F")).toEqual({ type: "end" });
    expect(parseCsiSequence("\x1b[3~")).toEqual({ type: "delete" });
    expect(parseCsiSequence("\x1b[5~")).toEqual({ type: "scroll-page-up" });
    expect(parseCsiSequence("\x1b[6~")).toEqual({ type: "scroll-page-down" });
  });

  it("maps SGR mouse wheel CSI sequences", () => {
    expect(parseCsiSequence("\x1b[<64;80;12M")).toEqual({ type: "scroll-line-up" });
    expect(parseCsiSequence("\x1b[<65;80;12M")).toEqual({ type: "scroll-line-down" });
    expect(parseCsiSequence("\x1b[<80;80;12M")).toEqual({ type: "scroll-line-up" });
    expect(parseCsiSequence("\x1b[<81;80;12M")).toEqual({ type: "scroll-line-down" });
    expect(parseCsiSequence("\x1b[<0;80;12M")).toBeNull();
  });

  it("returns null for unknown/invalid sequences", () => {
    expect(parseCsiSequence("plain")).toBeNull();
    expect(parseCsiSequence("\x1b[99x")).toBeNull();
  });
});

describe("InputEngine", () => {
  it("parses text insertion and submit from CR", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("hello\r")).toEqual([
      { type: "insert", text: "hello" },
      { type: "submit" }
    ]);
  });

  it("maps LF newline and backspace variants", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("x\n")).toEqual([{ type: "insert", text: "x" }, { type: "newline" }]);
    expect(engine.pushChunk("\x7f\b")).toEqual([{ type: "backspace" }, { type: "backspace" }]);
  });

  it("treats alt-style ESC+CR/LF as newline", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk(Buffer.from([0x1b, 0x0d]))).toEqual([{ type: "newline" }]);
    expect(engine.pushChunk(Buffer.from([0x1b, 0x0a]))).toEqual([{ type: "newline" }]);
  });

  it("maps SS3 keypad enter to submit", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1bOM")).toEqual([{ type: "submit" }]);
  });

  it("parses modified enter CSI sequences even when split across chunks", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1b[13;")).toEqual([]);
    expect(engine.pushChunk("5u")).toEqual([{ type: "newline" }]);

    expect(engine.pushChunk("\x1b[1;")).toEqual([]);
    expect(engine.pushChunk("5M")).toEqual([{ type: "newline" }]);
  });

  it("parses arrows and delete from CSI bytes", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1b[A\x1b[B\x1b[3~")).toEqual([
      { type: "move-up" },
      { type: "move-down" },
      { type: "delete" }
    ]);
  });

  it("parses page scroll actions from CSI bytes", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1b[5~\x1b[6~")).toEqual([
      { type: "scroll-page-up" },
      { type: "scroll-page-down" }
    ]);
  });

  it("parses mouse wheel scroll actions from CSI bytes", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1b[<64;80;12M\x1b[<65;80;12M\x1b[<80;80;12M\x1b[<81;80;12M")).toEqual([
      { type: "scroll-line-up" },
      { type: "scroll-line-down" },
      { type: "scroll-line-up" },
      { type: "scroll-line-down" }
    ]);
  });

  it("parses split mouse wheel CSI sequences", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk("\x1b[<64;80;")).toEqual([]);
    expect(engine.pushChunk("12M")).toEqual([{ type: "scroll-line-up" }]);
  });

  it("keeps UTF-8 insertion stable across chunk boundaries", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk(Buffer.from([0xe2, 0x82]))).toEqual([]);
    expect(engine.pushChunk(Buffer.from([0xac]))).toEqual([{ type: "insert", text: "€" }]);
  });

  it("emits cancel for Ctrl+C", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk(Buffer.from([0x03]))).toEqual([{ type: "cancel" }]);
  });

  it("emits cancel for lone Esc", () => {
    const engine = new InputEngine();
    expect(engine.pushChunk(Buffer.from([0x1b]))).toEqual([{ type: "cancel" }]);
  });
});
