import { describe, expect, it } from "vitest";

import { createDefaultRegistry } from "#agent/commands/commands";
import { buildPromptComposerLayout, PromptComposer } from "#ui/prompt/prompt-composer";

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

  it("keeps tab as a no-op for slash tokens", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/help", "/hello", "/exit"]
    });

    typeText(composer, "/he");
    expect(composer.handleKey("TAB")).toEqual({ type: "none" });
    expect(composer.getText()).toBe("/he");
  });

  it("tracks autocomplete menu state and supports selection movement + accept", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/help", "/hello", "/exit"]
    });

    typeText(composer, "/he");
    expect(composer.getAutocompleteMenuState()).toEqual({
      token: "/he",
      tokenStart: 0,
      tokenEnd: 3,
      options: ["/help", "/hello"],
      selectedIndex: 0
    });

    composer.moveAutocompleteSelection(1);
    expect(composer.getAutocompleteMenuState()?.selectedIndex).toBe(1);

    composer.acceptAutocompleteSelection();
    expect(composer.getText()).toBe("/hello");
    expect(composer.getAutocompleteMenuState()).toBeNull();
    expect(composer.handleKey("ENTER")).toEqual({ type: "submit", value: "/hello" });
  });

  it("does not auto-insert a single slash match until accepted", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/backend", "/download"]
    });

    typeText(composer, "/backend");
    expect(composer.getAutocompleteMenuState()).toEqual({
      token: "/backend",
      tokenStart: 0,
      tokenEnd: 8,
      options: ["/backend"],
      selectedIndex: 0
    });
    expect(composer.getText()).toBe("/backend");
    expect(composer.handleKey("TAB")).toEqual({ type: "none" });
    expect(composer.getText()).toBe("/backend");
  });

  it("autocomplete list includes restored catalog commands from the registry list", () => {
    const registry = createDefaultRegistry();
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: registry.getAutocompleteCommands()
    });

    typeText(composer, "/ba");
    const menu = composer.getAutocompleteMenuState();
    expect(menu?.options).toContain("/backend");
  });

  it("returns live autocomplete suggestions while typing slash commands", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/help", "/download", "/dl"]
    });

    typeText(composer, "/d");
    const suggestions = composer.getAutocompleteSuggestions();
    expect(suggestions).not.toBeNull();
    expect(suggestions?.options).toEqual(["/download", "/dl"]);
    expect(suggestions?.token).toBe("/d");
  });

  it("closes autocomplete when the current token is no longer a slash command", () => {
    const composer = new PromptComposer({
      interiorWidth: 30,
      history: [],
      autoComplete: ["/help", "/hello", "/exit"]
    });

    typeText(composer, "/he");
    expect(composer.getAutocompleteMenuState()).not.toBeNull();
    typeText(composer, " ");
    expect(composer.getAutocompleteMenuState()).toBeNull();
  });

  it("suggests local model IDs for /model by model-id prefix", () => {
    const composer = new PromptComposer({
      interiorWidth: 40,
      history: [],
      commandAutoComplete: ["/model", "/nick"],
      modelAutoComplete: [
        {
          value: "org/repo/model-q4.gguf",
          aliases: ["org/repo", "model-q4.gguf", "model-q4"]
        }
      ]
    });

    typeText(composer, "/model org/");
    expect(composer.getAutocompleteMenuState()?.options).toEqual(["org/repo/model-q4.gguf"]);
  });

  it("suggests local model IDs for /model by repo and filename aliases", () => {
    const composer = new PromptComposer({
      interiorWidth: 40,
      history: [],
      commandAutoComplete: ["/model"],
      modelAutoComplete: [
        {
          value: "org/repo/model-q4.gguf",
          aliases: ["org/repo", "model-q4.gguf", "model-q4"]
        }
      ]
    });

    typeText(composer, "/model model-q");
    expect(composer.getAutocompleteMenuState()?.options).toEqual(["org/repo/model-q4.gguf"]);

    composer.clearAutocompleteSelection();
    while (composer.getCursor() > 0) {
      composer.handleKey("BACKSPACE");
    }
    typeText(composer, "/model org/repo");
    expect(composer.getAutocompleteMenuState()?.options).toEqual(["org/repo/model-q4.gguf"]);
  });

  it("shows local model options for /model with empty first argument", () => {
    const composer = new PromptComposer({
      interiorWidth: 40,
      history: [],
      commandAutoComplete: ["/model"],
      modelAutoComplete: [
        { value: "org/repo/a.gguf", aliases: ["org/repo", "a.gguf", "a"] },
        { value: "org/repo/b.gguf", aliases: ["org/repo", "b.gguf", "b"] }
      ]
    });

    typeText(composer, "/model ");
    expect(composer.getAutocompleteMenuState()?.options).toEqual([
      "org/repo/a.gguf",
      "org/repo/b.gguf"
    ]);
  });

  it("supports /nick model-target completion only for first argument", () => {
    const composer = new PromptComposer({
      interiorWidth: 40,
      history: [],
      commandAutoComplete: ["/nick"],
      modelAutoComplete: [
        {
          value: "org/repo/model-q4.gguf",
          aliases: ["org/repo", "model-q4.gguf", "model-q4"]
        }
      ]
    });

    typeText(composer, "/nick model-q");
    expect(composer.getAutocompleteMenuState()?.options).toEqual(["org/repo/model-q4.gguf"]);

    composer.acceptAutocompleteSelection();
    typeText(composer, " speedy");
    expect(composer.getAutocompleteMenuState()).toBeNull();
  });

  it("updates model suggestions when candidates are refreshed", () => {
    const composer = new PromptComposer({
      interiorWidth: 40,
      history: [],
      commandAutoComplete: ["/model"],
      modelAutoComplete: []
    });

    typeText(composer, "/model ");
    expect(composer.getAutocompleteMenuState()).toBeNull();

    composer.setModelAutocompleteCandidates([
      {
        value: "org/repo/model-q4.gguf",
        aliases: ["org/repo", "model-q4.gguf", "model-q4"]
      }
    ]);
    expect(composer.getAutocompleteMenuState()?.options).toEqual(["org/repo/model-q4.gguf"]);
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
