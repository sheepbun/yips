import { describe, expect, it } from "vitest";

import { buildPromptComposerLayout, PromptComposer } from "../src/prompt-composer";

function typeText(composer: PromptComposer, text: string): void {
  for (const char of Array.from(text)) {
    composer.handleKey(char, { isCharacter: true });
  }
}

describe("buildPromptComposerLayout", () => {
  it("wraps text to prompt interior width with prefix-aware first row", () => {
    const layout = buildPromptComposerLayout("abcdefghijklmn", 14, 10, ">>> ");

    expect(layout.rows).toEqual(["abcdef", "ghijklmn"]);
    expect(layout.rowCount).toBe(2);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorCol).toBe(8);
    expect(layout.prefix).toBe(">>> ");
  });

  it("treats explicit newline as a hard row break", () => {
    const layout = buildPromptComposerLayout("abc\ndef", 7, 20, ">>> ");

    expect(layout.rows).toEqual(["abc", "def"]);
    expect(layout.rowStarts).toEqual([0, 4]);
    expect(layout.rowEnds).toEqual([3, 7]);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorCol).toBe(3);
  });
});

describe("PromptComposer", () => {
  it("supports vertical cursor movement across wrapped rows", () => {
    const composer = new PromptComposer({
      interiorWidth: 10,
      history: [],
      autoComplete: [],
      prefix: ">>> "
    });

    typeText(composer, "abcdefghijkl");
    expect(composer.getLayout().rowCount).toBe(2);
    expect(composer.getLayout().cursorRow).toBe(1);

    composer.handleKey("UP");
    expect(composer.getLayout().cursorRow).toBe(0);

    composer.handleKey("DOWN");
    expect(composer.getLayout().cursorRow).toBe(1);
  });

  it("navigates history and restores draft text", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: ["first", "second"],
      autoComplete: []
    });

    typeText(composer, "draft");
    composer.handleKey("UP");
    expect(composer.getText()).toBe("second");

    composer.handleKey("UP");
    expect(composer.getText()).toBe("first");

    composer.handleKey("DOWN");
    expect(composer.getText()).toBe("second");

    composer.handleKey("DOWN");
    expect(composer.getText()).toBe("draft");
  });

  it("expands shared autocomplete prefixes and returns menu events for ambiguity", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/help", "/hello", "/exit"]
    });

    typeText(composer, "/he");
    expect(composer.handleKey("TAB")).toEqual({ type: "none" });
    expect(composer.getText()).toBe("/hel");

    const event = composer.handleKey("TAB");
    expect(event.type).toBe("autocomplete-menu");
    if (event.type === "autocomplete-menu") {
      expect(event.options).toEqual(["/help", "/hello"]);
      composer.applyAutocompleteChoice(event.tokenStart, event.tokenEnd, "/help");
    }
    expect(composer.getText()).toBe("/help");
  });

  it("returns submit and cancel events", () => {
    const composer = new PromptComposer({
      interiorWidth: 20,
      history: [],
      autoComplete: []
    });

    typeText(composer, "ship it");
    expect(composer.handleKey("ENTER")).toEqual({ type: "submit", value: "ship it" });
    expect(composer.handleKey("ESCAPE")).toEqual({ type: "cancel" });
  });

  it("inserts newline only with Ctrl+Enter and keeps Ctrl+M as submit", () => {
    const composer = new PromptComposer({
      interiorWidth: 20,
      history: [],
      autoComplete: []
    });

    typeText(composer, "hello");
    expect(composer.handleKey("CTRL_ENTER")).toEqual({ type: "none" });
    typeText(composer, "world");

    expect(composer.getText()).toBe("hello\nworld");
    expect(composer.getLayout().rowCount).toBe(2);

    expect(composer.handleKey("SHIFT_ENTER")).toEqual({ type: "none" });
    expect(composer.handleKey("ALT_ENTER")).toEqual({ type: "none" });
    expect(composer.handleKey("CTRL_SHIFT_ENTER")).toEqual({ type: "none" });
    expect(composer.getText()).toBe("hello\nworld");

    expect(composer.handleKey("CTRL_M")).toEqual({ type: "submit", value: "hello\nworld" });
    expect(composer.handleKey("ENTER")).toEqual({ type: "submit", value: "hello\nworld" });
  });
});
