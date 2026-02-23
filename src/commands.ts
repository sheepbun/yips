/** Slash command registry and dispatch system. */

import type { AppConfig } from "./types";

export interface CommandResult {
  output?: string;
  action: "continue" | "exit" | "clear";
}

export interface SessionContext {
  config: AppConfig;
  messageCount: number;
}

export type CommandHandler = (args: string, context: SessionContext) => CommandResult;

interface RegisteredCommand {
  name: string;
  description: string;
  handler: CommandHandler;
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();

  register(name: string, handler: CommandHandler, description: string): void {
    this.commands.set(name.toLowerCase(), { name, description, handler });
  }

  dispatch(name: string, args: string, context: SessionContext): CommandResult {
    const command = this.commands.get(name.toLowerCase());
    if (!command) {
      return {
        output: `Unknown command: /${name}. Type /help for help.`,
        action: "continue"
      };
    }
    return command.handler(args, context);
  }

  getHelp(): string {
    const lines = ["Available commands:"];
    for (const cmd of this.commands.values()) {
      lines.push(`  /${cmd.name}  - ${cmd.description}`);
    }
    return lines.join("\n");
  }

  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  getNames(): string[] {
    return [...this.commands.keys()];
  }
}

export interface ParsedCommand {
  command: string;
  args: string;
}

const KEY_DIAGNOSTICS_TEXT = [
  "Key diagnostics:",
  "1) Run: YIPS_DEBUG_KEYS=1 npm run dev",
  "2) Press Enter and Ctrl+Enter in the prompt box.",
  "3) Compare [debug stdin] output lines for action differences.",
  "If Ctrl+Enter logs only submit from plain CR, your terminal is not emitting a distinct modified-enter sequence.",
  "For Alacritty, map Ctrl+Enter to CSI-u (\\u001b[13;5u).",
  "If needed, use a fallback mapping Yips also supports: \\u001b[13;5~."
].join("\n");

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }

  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim()
  };
}

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(
    "help",
    () => ({
      output: registry.getHelp(),
      action: "continue"
    }),
    "Show this help"
  );

  registry.register("exit", () => ({ output: "Goodbye.", action: "exit" }), "Exit Yips");

  registry.register("quit", () => ({ output: "Goodbye.", action: "exit" }), "Exit Yips");

  registry.register("clear", () => ({ action: "clear" }), "Clear the screen");

  registry.register("new", () => ({ action: "clear" }), "Start a new conversation");

  registry.register(
    "model",
    (args, context) => {
      const trimmed = args.trim();
      if (trimmed.length > 0) {
        context.config.model = trimmed;
        return { output: `Model set to: ${trimmed}`, action: "continue" };
      }
      return {
        output: `Current model: ${context.config.model}\nUsage: /model <model_name>`,
        action: "continue"
      };
    },
    "View or set the current model"
  );

  registry.register(
    "stream",
    (_args, context) => {
      context.config.streaming = !context.config.streaming;
      const state = context.config.streaming ? "enabled" : "disabled";
      return { output: `Streaming ${state}.`, action: "continue" };
    },
    "Toggle streaming mode"
  );

  registry.register(
    "verbose",
    (_args, context) => {
      context.config.verbose = !context.config.verbose;
      const state = context.config.verbose ? "enabled" : "disabled";
      return { output: `Verbose mode ${state}.`, action: "continue" };
    },
    "Toggle verbose mode"
  );

  registry.register(
    "keys",
    () => ({
      output: KEY_DIAGNOSTICS_TEXT,
      action: "continue"
    }),
    "Show key input diagnostics for Enter/Ctrl+Enter"
  );

  return registry;
}
