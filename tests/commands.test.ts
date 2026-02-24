import { describe, expect, it } from "vitest";

import { CommandRegistry, createDefaultRegistry, parseCommand } from "../src/commands";
import type { SessionContext } from "../src/commands";
import { getDefaultConfig } from "../src/config";

function createContext(): SessionContext {
  return {
    config: getDefaultConfig(),
    messageCount: 0
  };
}

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });

  it("parses a command without arguments", () => {
    expect(parseCommand("/help")).toEqual({ command: "help", args: "" });
    expect(parseCommand("/exit")).toEqual({ command: "exit", args: "" });
  });

  it("parses a command with arguments", () => {
    expect(parseCommand("/model qwen3")).toEqual({ command: "model", args: "qwen3" });
  });

  it("normalizes command to lowercase", () => {
    expect(parseCommand("/HELP")).toEqual({ command: "help", args: "" });
    expect(parseCommand("/Model Qwen3")).toEqual({ command: "model", args: "Qwen3" });
  });

  it("trims whitespace", () => {
    expect(parseCommand("  /help  ")).toEqual({ command: "help", args: "" });
    expect(parseCommand("  /model  qwen3  ")).toEqual({ command: "model", args: "qwen3" });
  });
});

describe("CommandRegistry", () => {
  it("registers and dispatches a command", () => {
    const registry = new CommandRegistry();
    registry.register("test", () => ({ output: "ok", action: "continue" }), "A test");

    const result = registry.dispatch("test", "", createContext());
    expect(result).toEqual({ output: "ok", action: "continue" });
  });

  it("returns unknown command for unregistered names", () => {
    const registry = new CommandRegistry();
    const result = registry.dispatch("nope", "", createContext());
    expect(result.output).toContain("Unknown command");
    expect(result.action).toBe("continue");
  });

  it("returns recognized-not-implemented for known catalog commands without handlers", () => {
    const registry = new CommandRegistry([
      { name: "backend", description: "Switch backend", kind: "builtin", implemented: false }
    ]);

    const result = registry.dispatch("backend", "", createContext());
    expect(result.output).toContain("recognized but not implemented");
    expect(result.action).toBe("continue");
  });

  it("has() checks command existence", () => {
    const registry = new CommandRegistry();
    registry.register("foo", () => ({ action: "continue" }), "Foo");
    expect(registry.has("foo")).toBe(true);
    expect(registry.has("bar")).toBe(false);
  });

  it("getHelp() lists all commands", () => {
    const registry = new CommandRegistry();
    registry.register("foo", () => ({ action: "continue" }), "Does foo");
    registry.register("bar", () => ({ action: "continue" }), "Does bar");

    const help = registry.getHelp();
    expect(help).toContain("/foo");
    expect(help).toContain("/bar");
    expect(help).toContain("Does foo");
  });

  it("is case-insensitive", () => {
    const registry = new CommandRegistry();
    registry.register("Test", () => ({ output: "ok", action: "continue" }), "Test");
    expect(registry.has("test")).toBe(true);
    expect(registry.has("TEST")).toBe(true);
  });
});

describe("createDefaultRegistry", () => {
  it("includes expected implemented and restored commands", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("help")).toBe(true);
    expect(registry.has("exit")).toBe(true);
    expect(registry.has("quit")).toBe(true);
    expect(registry.has("clear")).toBe(true);
    expect(registry.has("new")).toBe(true);
    expect(registry.has("model")).toBe(true);
    expect(registry.has("stream")).toBe(true);
    expect(registry.has("verbose")).toBe(true);
    expect(registry.has("keys")).toBe(true);
    expect(registry.has("backend")).toBe(true);
    expect(registry.has("sessions")).toBe(true);
    expect(registry.has("download")).toBe(true);
    expect(registry.has("models")).toBe(true);
    expect(registry.has("search")).toBe(true);
    expect(registry.has("vt")).toBe(true);
  });

  it("/help lists commands", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("help", "", createContext());
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/exit");
    expect(result.output).toContain("/backend");
    expect(result.output).toContain("Recognized (not implemented in this rewrite yet)");
    expect(result.action).toBe("continue");
  });

  it("returns recognized-not-implemented output for restored metadata commands", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("backend", "", createContext());
    expect(result.output).toContain("recognized but not implemented");
    expect(result.action).toBe("continue");
  });

  it("/exit returns exit action", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("exit", "", createContext());
    expect(result.action).toBe("exit");
  });

  it("/clear returns clear action", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("clear", "", createContext());
    expect(result.action).toBe("clear");
  });

  it("/new returns clear action", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("new", "", createContext());
    expect(result.action).toBe("clear");
  });

  it("/stream toggles streaming", () => {
    const registry = createDefaultRegistry();
    const context = createContext();
    expect(context.config.streaming).toBe(true);

    const result = registry.dispatch("stream", "", context);
    expect(context.config.streaming).toBe(false);
    expect(result.output).toContain("disabled");

    registry.dispatch("stream", "", context);
    expect(context.config.streaming).toBe(true);
  });

  it("/verbose toggles verbose mode", () => {
    const registry = createDefaultRegistry();
    const context = createContext();
    expect(context.config.verbose).toBe(false);

    const result = registry.dispatch("verbose", "", context);
    expect(context.config.verbose).toBe(true);
    expect(result.output).toContain("enabled");
  });

  it("/model shows current model and usage without args", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("model", "", createContext());
    expect(result.output).toContain("Current model");
    expect(result.output).toContain("Usage");
  });

  it("/model sets model with args", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("model", "qwen3", createContext());
    expect(result.output).toContain("qwen3");
  });

  it("/keys shows diagnostics guidance", () => {
    const registry = createDefaultRegistry();
    const result = registry.dispatch("keys", "", createContext());
    expect(result.action).toBe("continue");
    expect(result.output).toContain("YIPS_DEBUG_KEYS=1 npm run dev");
    expect(result.output).toContain("Ctrl+Enter");
    expect(result.output).toContain("\\u001b[13;5u");
    expect(result.output).toContain("\\u001b[13;5~");
  });

  it("provides slash-prefixed autocomplete command list", () => {
    const registry = createDefaultRegistry();
    const autocomplete = registry.getAutocompleteCommands();

    expect(autocomplete).toContain("/help");
    expect(autocomplete).toContain("/backend");
    expect(autocomplete).toContain("/search");
  });
});
