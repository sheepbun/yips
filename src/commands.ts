/** Slash command registry and dispatch system. */

import { loadCommandCatalog } from "./command-catalog";
import type { CommandDescriptor, CommandKind } from "./command-catalog";
import { saveConfig } from "./config";
import { listLocalModels, findMatchingModel } from "./model-manager";
import {
  downloadModelFile,
  isHfDownloadUrl,
  parseHfDownloadUrl,
  resolveDefaultModelsDir
} from "./model-downloader";
import type { AppConfig } from "./types";

export interface CommandResult {
  output?: string;
  action: "continue" | "exit" | "clear" | "restart";
  uiAction?:
    | { type: "open-downloader" }
    | { type: "open-model-manager" }
    | { type: "open-sessions" };
}

export interface SessionContext {
  config: AppConfig;
  messageCount: number;
}

type MaybePromise<T> = T | Promise<T>;

export type CommandHandler = (args: string, context: SessionContext) => MaybePromise<CommandResult>;

interface RegisteredCommand {
  name: string;
  description: string;
  handler: CommandHandler;
}

function isGenericDescription(description: string): boolean {
  const trimmed = description.trim();
  return trimmed.length === 0 || trimmed === "Command";
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private descriptors: Map<string, CommandDescriptor> = new Map();

  constructor(initialDescriptors: readonly CommandDescriptor[] = []) {
    for (const descriptor of initialDescriptors) {
      const name = descriptor.name.toLowerCase();
      this.descriptors.set(name, { ...descriptor, name });
    }
  }

  register(
    name: string,
    handler: CommandHandler,
    description: string,
    kind: CommandKind = "builtin"
  ): void {
    const normalizedName = name.toLowerCase();
    const existing = this.descriptors.get(normalizedName);
    const mergedDescription =
      existing && !isGenericDescription(existing.description) ? existing.description : description;

    this.commands.set(normalizedName, {
      name: normalizedName,
      description: mergedDescription,
      handler
    });
    this.descriptors.set(normalizedName, {
      name: normalizedName,
      description: mergedDescription,
      kind: existing?.kind ?? kind,
      implemented: true
    });
  }

  async dispatch(name: string, args: string, context: SessionContext): Promise<CommandResult> {
    const command = this.commands.get(name.toLowerCase());
    if (command) {
      return await command.handler(args, context);
    }

    if (this.descriptors.has(name.toLowerCase())) {
      return {
        output:
          `Command /${name} is recognized but not implemented in this TypeScript rewrite yet. ` +
          "Type /help to see implemented commands.",
        action: "continue"
      };
    }

    return {
      output: `Unknown command: /${name}. Type /help for help.`,
      action: "continue"
    };
  }

  getHelp(): string {
    const commands = this.listCommands();
    const implemented = commands.filter((command) => command.implemented);
    const planned = commands.filter((command) => !command.implemented);

    const lines = ["Available commands:"];

    lines.push("Implemented:");
    for (const cmd of implemented) {
      lines.push(`  /${cmd.name}  - ${cmd.description}`);
    }

    if (planned.length > 0) {
      lines.push("");
      lines.push("Recognized (not implemented in this rewrite yet):");
      for (const cmd of planned) {
        lines.push(`  /${cmd.name}  - ${cmd.description}`);
      }
    }

    return lines.join("\n");
  }

  has(name: string): boolean {
    return this.descriptors.has(name.toLowerCase());
  }

  getNames(): string[] {
    return this.listCommands().map((command) => command.name);
  }

  listCommands(): CommandDescriptor[] {
    return [...this.descriptors.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  getAutocompleteCommands(): string[] {
    return this.getNames().map((name) => `/${name}`);
  }
}

export interface ParsedCommand {
  command: string;
  args: string;
}

function splitCommandArgs(input: string): string[] {
  const matches = input.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/gu);
  if (!matches) {
    return [];
  }

  return matches.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

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
  const registry = new CommandRegistry(loadCommandCatalog());

  const downloadUsage = [
    "Model downloader:",
    "  /download                    Open interactive downloader",
    "  /download <hf_url>           Download directly from hf.co/huggingface URL",
    "  /dl ...                      Alias for /download"
  ].join("\n");

  const handleDownload = async (args: string): Promise<CommandResult> => {
    const trimmed = args.trim();
    const tokens = trimmed.length > 0 ? trimmed.split(/\s+/u) : [];

    try {
      if (tokens.length === 0) {
        return {
          action: "continue",
          uiAction: { type: "open-downloader" }
        };
      }

      const inputArg = tokens.join(" ");

      if (inputArg.toLowerCase() === "help") {
        return { output: downloadUsage, action: "continue" };
      }

      if (!isHfDownloadUrl(inputArg)) {
        return {
          output: `Invalid /download argument. Only direct Hugging Face URLs are supported.\n\n${downloadUsage}`,
          action: "continue"
        };
      }

      const parsed = parseHfDownloadUrl(inputArg);
      const result = await downloadModelFile(parsed);
      const modelsDir = resolveDefaultModelsDir();

      return {
        output:
          `Downloaded ${parsed.filename} from ${parsed.repoId}.\n` +
          `Saved to: ${result.localPath}\n` +
          `Models dir: ${modelsDir}\n` +
          `Use with: /model ${parsed.repoId}/${parsed.filename}`,
        action: "continue"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: `Download command failed: ${message}`,
        action: "continue"
      };
    }
  };

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

  registry.register(
    "restart",
    () => ({ output: "Restarting Yips.", action: "restart" }),
    "Restart Yips"
  );

  registry.register("clear", () => ({ action: "clear" }), "Clear the screen");

  registry.register("new", () => ({ action: "clear" }), "Start a new conversation");

  registry.register(
    "model",
    async (args, context) => {
      try {
        const trimmed = args.trim();
        if (trimmed.length === 0) {
          return { action: "continue", uiAction: { type: "open-model-manager" } };
        }

        let selectedModel = trimmed;
        const localModels = await listLocalModels({ nicknames: context.config.nicknames });
        const matched = findMatchingModel(localModels, trimmed);
        if (matched) {
          selectedModel = matched.id;
        }

        context.config.backend = "llamacpp";
        context.config.model = selectedModel;
        await saveConfig(context.config);

        const matchSuffix = matched ? ` (matched from '${trimmed}')` : " (free-form fallback)";
        return { output: `Model set to: ${selectedModel}${matchSuffix}`, action: "continue" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: `Model command failed: ${message}`,
          action: "continue"
        };
      }
    },
    "View or set the current model"
  );

  registry.register(
    "models",
    async () => {
      return { action: "continue", uiAction: { type: "open-model-manager" } };
    },
    "Open the interactive Model Manager"
  );

  registry.register(
    "sessions",
    async () => {
      return { action: "continue", uiAction: { type: "open-sessions" } };
    },
    "Interactively select and load a session"
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

  registry.register("download", (args) => handleDownload(args), "Open the model downloader");

  registry.register("dl", (args) => handleDownload(args), "Alias for /download");

  registry.register(
    "nick",
    async (args, context) => {
      try {
        const tokens = splitCommandArgs(args.trim());
        if (tokens.length < 2) {
          return {
            output: "Usage: /nick <model_name_or_filename> <nickname>",
            action: "continue"
          };
        }

        const [target, ...nicknameTokens] = tokens;
        const nickname = nicknameTokens.join(" ").trim();
        if (!target || nickname.length === 0) {
          return {
            output: "Usage: /nick <model_name_or_filename> <nickname>",
            action: "continue"
          };
        }

        context.config.nicknames[target] = nickname;
        await saveConfig(context.config);
        return {
          output: `Nickname set: ${target} -> ${nickname}`,
          action: "continue"
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: `Nick command failed: ${message}`,
          action: "continue"
        };
      }
    },
    "Set a custom nickname for a model"
  );

  return registry;
}
