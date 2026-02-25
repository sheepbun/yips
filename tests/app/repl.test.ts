import { describe, expect, it } from "vitest";

import { getDefaultConfig } from "#config/config";
import { handleInput, renderHelpText } from "#app/repl";
import type { SessionState } from "#types/app-types";

function createState(): SessionState {
  return {
    messageCount: 0,
    running: true,
    config: getDefaultConfig()
  };
}

describe("handleInput", () => {
  it("returns exit action for /exit and /quit", () => {
    const state = createState();

    expect(handleInput("/exit", state)).toEqual({ type: "exit" });
    expect(handleInput("/quit", state)).toEqual({ type: "exit" });
  });

  it("returns help action for /help", () => {
    const state = createState();

    expect(handleInput("/help", state)).toEqual({ type: "help" });
  });

  it("returns echo action for regular text", () => {
    const state = createState();

    expect(handleInput("hello world", state)).toEqual({ type: "echo", text: "hello world" });
  });

  it("returns unknown action for unsupported slash commands", () => {
    const state = createState();

    expect(handleInput("/model", state)).toEqual({ type: "unknown", command: "model" });
  });

  it("returns restart action for /restart", () => {
    const state = createState();
    expect(handleInput("/restart", state)).toEqual({ type: "restart" });
  });
});

describe("renderHelpText", () => {
  it("lists supported bootstrap commands", () => {
    const helpText = renderHelpText();

    expect(helpText).toContain("/help");
    expect(helpText).toContain("/exit");
    expect(helpText).toContain("/restart");
  });
});
