import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry, createDefaultRegistry, parseCommand } from "../src/commands";
import type { SessionContext } from "../src/commands";
import { loadConfig } from "../src/config";
import { getDefaultConfig } from "../src/config";

function createContext(): SessionContext {
  return {
    config: getDefaultConfig(),
    messageCount: 0
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  it("registers and dispatches a command", async () => {
    const registry = new CommandRegistry();
    registry.register("test", () => ({ output: "ok", action: "continue" }), "A test");

    const result = await registry.dispatch("test", "", createContext());
    expect(result).toEqual({ output: "ok", action: "continue" });
  });

  it("returns unknown command for unregistered names", async () => {
    const registry = new CommandRegistry();
    const result = await registry.dispatch("nope", "", createContext());
    expect(result.output).toContain("Unknown command");
    expect(result.action).toBe("continue");
  });

  it("returns recognized-not-implemented for known catalog commands without handlers", async () => {
    const registry = new CommandRegistry([
      { name: "backend", description: "Switch backend", kind: "builtin", implemented: false }
    ]);

    const result = await registry.dispatch("backend", "", createContext());
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
    expect(registry.has("restart")).toBe(true);
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

  it("/help lists commands", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("help", "", createContext());
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/exit");
    expect(result.output).toContain("/backend");
    expect(result.output).toContain("Recognized (not implemented in this rewrite yet)");
    expect(result.action).toBe("continue");
  });

  it("returns recognized-not-implemented output for restored metadata commands", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("backend", "", createContext());
    expect(result.output).toContain("recognized but not implemented");
    expect(result.action).toBe("continue");
  });

  it("/exit returns exit action", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("exit", "", createContext());
    expect(result.action).toBe("exit");
  });

  it("/restart returns restart action", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("restart", "", createContext());
    expect(result.action).toBe("restart");
    expect(result.output).toContain("Restarting");
  });

  it("/clear returns clear action", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("clear", "", createContext());
    expect(result.action).toBe("clear");
  });

  it("/new returns clear action", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("new", "", createContext());
    expect(result.action).toBe("clear");
  });

  it("/stream toggles streaming", async () => {
    const registry = createDefaultRegistry();
    const context = createContext();
    expect(context.config.streaming).toBe(true);

    const result = await registry.dispatch("stream", "", context);
    expect(context.config.streaming).toBe(false);
    expect(result.output).toContain("disabled");

    await registry.dispatch("stream", "", context);
    expect(context.config.streaming).toBe(true);
  });

  it("/verbose toggles verbose mode", async () => {
    const registry = createDefaultRegistry();
    const context = createContext();
    expect(context.config.verbose).toBe(false);

    const result = await registry.dispatch("verbose", "", context);
    expect(context.config.verbose).toBe(true);
    expect(result.output).toContain("enabled");
  });

  it("/model shows current model and usage without args", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("model", "", createContext());
    expect(result.output).toBeUndefined();
    expect(result.uiAction).toEqual({ type: "open-model-manager" });
  });

  it("/model sets model with args", async () => {
    const registry = createDefaultRegistry();
    const dir = await mkdtemp(join(tmpdir(), "yips-command-model-"));
    process.env["YIPS_MODELS_DIR"] = dir;
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const modelDir = join(dir, "org", "repo");
      await mkdir(modelDir, { recursive: true });
      await writeFile(join(modelDir, "qwen3.gguf"), "binary", "utf8");

      const context = createContext();
      const result = await registry.dispatch("model", "qwen3", context);
      expect(result.output).toContain("org/repo/qwen3.gguf");
      expect(context.config.model).toBe("org/repo/qwen3.gguf");
    } finally {
      process.chdir(originalCwd);
      delete process.env["YIPS_MODELS_DIR"];
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("/models opens model manager and ignores args", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("models", "anything", createContext());
    expect(result.action).toBe("continue");
    expect(result.uiAction).toEqual({ type: "open-model-manager" });
  });

  it("/sessions opens interactive session picker", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("sessions", "", createContext());
    expect(result.action).toBe("continue");
    expect(result.uiAction).toEqual({ type: "open-sessions" });
  });

  it("/keys shows diagnostics guidance", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("keys", "", createContext());
    expect(result.action).toBe("continue");
    expect(result.output).toContain("YIPS_DEBUG_KEYS=1 npm run dev");
    expect(result.output).toContain("Ctrl+Enter");
    expect(result.output).toContain("\\u001b[13;5u");
    expect(result.output).toContain("\\u001b[13;5~");
  });

  it("/download opens the interactive downloader when called without args", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("download", "", createContext());
    expect(result.action).toBe("continue");
    expect(result.uiAction).toEqual({ type: "open-downloader" });
  });

  it("/download rejects non-HF URL arguments", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("download", "qwen", createContext());
    expect(result.action).toBe("continue");
    expect(result.output).toContain("Invalid /download argument");
  });

  it("/download supports direct HF URL downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(new TextEncoder().encode("gguf-binary"));
              controller.close();
            }
          }),
          { status: 200 }
        )
      )
    );

    const root = await mkdtemp(join(tmpdir(), "yips-command-download-"));
    process.env["YIPS_MODELS_DIR"] = root;
    try {
      const registry = createDefaultRegistry();
      const result = await registry.dispatch(
        "download",
        "https://hf.co/org/model/resolve/main/model-q4.gguf",
        createContext()
      );
      expect(result.action).toBe("continue");
      expect(result.output).toContain("Downloaded model-q4.gguf from org/model");
    } finally {
      delete process.env["YIPS_MODELS_DIR"];
      await rm(root, { recursive: true, force: true });
    }
  });

  it("/dl is an alias for /download modal mode", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("dl", "", createContext());
    expect(result.action).toBe("continue");
    expect(result.uiAction).toEqual({ type: "open-downloader" });
  });

  it("/nick persists nickname to config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yips-command-nick-"));
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const registry = createDefaultRegistry();
      const result = await registry.dispatch("nick", 'qwen3 "qwen-fast"', createContext());
      expect(result.output).toContain("Nickname set");

      const loaded = await loadConfig();
      expect(loaded.config.nicknames["qwen3"]).toBe("qwen-fast");
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("provides slash-prefixed autocomplete command list", () => {
    const registry = createDefaultRegistry();
    const autocomplete = registry.getAutocompleteCommands();

    expect(autocomplete).toContain("/help");
    expect(autocomplete).toContain("/backend");
    expect(autocomplete).toContain("/search");
  });
});
