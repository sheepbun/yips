/** Slash command registry and dispatch system. */

import { loadCommandCatalog } from "#agent/commands/command-catalog";
import type { CommandDescriptor, CommandKind } from "#agent/commands/command-catalog";
import { checkForUpdates, getInstalledPackageVersion } from "#app/update-check";
import { saveConfig } from "#config/config";
import { listMemories, readMemory, saveMemory } from "#agent/context/memory-store";
import { listLocalModels, findMatchingModel } from "#models/model-manager";
import {
  downloadModelFile,
  isHfDownloadUrl,
  parseHfDownloadUrl,
  resolveDefaultModelsDir
} from "#models/model-downloader";
import { executeFetchSkill, executeSearchSkill } from "#agent/skills/skills";
import type { AppConfig } from "#types/app-types";

export interface CommandResult {
  output?: string;
  action: "continue" | "exit" | "clear" | "restart";
  uiAction?:
    | { type: "open-downloader" }
    | { type: "open-model-manager" }
    | { type: "open-sessions" }
    | { type: "open-vt" }
    | { type: "open-setup" }
    | { type: "set-mouse-capture"; mode: "on" | "off" | "toggle" | "status" };
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

function parseTokenCountArg(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(/^(\d+)(k)?$/u);
  if (!match) {
    return null;
  }

  const raw = Number(match[1]);
  if (!Number.isInteger(raw) || raw <= 0) {
    return null;
  }

  const multiplier = match[2] === "k" ? 1000 : 1;
  return raw * multiplier;
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

  const memorizeUsage = [
    "Memory commands:",
    "  /memorize <fact>              Save a memory",
    "  /memorize list [limit]        List recent memories (default 10)",
    "  /memorize read <memory_id>    Read a saved memory",
    "  /memorize help                Show this help"
  ].join("\n");

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
    "sessions",
    async () => {
      return { action: "continue", uiAction: { type: "open-sessions" } };
    },
    "Interactively select and load a session"
  );

  registry.register(
    "vt",
    async () => ({ action: "continue", uiAction: { type: "open-vt" } }),
    "Open Virtual Terminal"
  );

  registry.register(
    "setup",
    async () => ({ action: "continue", uiAction: { type: "open-setup" } }),
    "Configure external chat channels"
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

  const mouseUsage = "Usage: /mouse [toggle|on|off|status]";
  registry.register(
    "mouse",
    (args) => {
      const trimmed = args.trim().toLowerCase();
      if (trimmed.length === 0 || trimmed === "toggle") {
        return {
          action: "continue",
          uiAction: { type: "set-mouse-capture", mode: "toggle" }
        };
      }
      if (trimmed === "on" || trimmed === "enable") {
        return { action: "continue", uiAction: { type: "set-mouse-capture", mode: "on" } };
      }
      if (trimmed === "off" || trimmed === "disable") {
        return { action: "continue", uiAction: { type: "set-mouse-capture", mode: "off" } };
      }
      if (trimmed === "status") {
        return {
          action: "continue",
          uiAction: { type: "set-mouse-capture", mode: "status" }
        };
      }
      return { action: "continue", output: mouseUsage };
    },
    "Toggle mouse capture mode for wheel scroll vs selection"
  );

  registry.register(
    "update",
    async () => {
      const currentVersion = await getInstalledPackageVersion();
      const result = await checkForUpdates(currentVersion);

      const guidance = [
        "Update options:",
        "  npm global (canonical): npm install -g @sheepbun/yips@latest",
        "  npm global (legacy/unscoped): npm install -g yips@latest (may be unavailable)",
        "  local source: git pull --ff-only && ./install.sh",
        "  docs: https://yips.dev"
      ];

      if (result.status === "update-available" && result.latestVersion) {
        return {
          output: [
            `Update available: ${result.currentVersion} -> ${result.latestVersion}`,
            ...guidance
          ].join("\n"),
          action: "continue"
        };
      }

      if (result.status === "up-to-date" && result.latestVersion) {
        return {
          output: [
            `You are up to date (${result.currentVersion}). Latest: ${result.latestVersion}.`,
            ...guidance
          ].join("\n"),
          action: "continue"
        };
      }

      const unknownReason = result.error ? ` (${result.error})` : "";
      return {
        output: [
          `Could not verify latest version${unknownReason}`,
          `Current version: ${result.currentVersion}`,
          ...guidance
        ].join("\n"),
        action: "continue"
      };
    },
    "Check for updates and show upgrade commands"
  );

  registry.register(
    "tokens",
    async (args, context) => {
      const trimmed = args.trim();
      if (trimmed.length === 0) {
        if (context.config.tokensMode === "auto") {
          return { output: "Tokens mode: auto (dynamic).", action: "continue" };
        }
        return {
          output: `Tokens mode: manual (${context.config.tokensManualMax}).`,
          action: "continue"
        };
      }

      if (trimmed.toLowerCase() === "auto") {
        context.config.tokensMode = "auto";
        await saveConfig(context.config);
        return {
          output: "Token limit mode set to auto.",
          action: "continue"
        };
      }

      const parsed = parseTokenCountArg(trimmed);
      if (parsed === null) {
        return {
          output: "Usage: /tokens auto | /tokens <positive_number|numberk>",
          action: "continue"
        };
      }

      context.config.tokensMode = "manual";
      context.config.tokensManualMax = parsed;
      await saveConfig(context.config);
      return {
        output: `Token limit set to ${parsed} (manual).`,
        action: "continue"
      };
    },
    "Show or set token counter mode and max"
  );

  registry.register("download", (args) => handleDownload(args), "Open the model downloader");

  registry.register("dl", (args) => handleDownload(args), "Alias for /download");

  registry.register(
    "search",
    async (args) => {
      const query = args.trim();
      if (query.length === 0) {
        return { action: "continue", output: "Usage: /search <query>" };
      }

      try {
        const output = await executeSearchSkill({ query });
        return { action: "continue", output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { action: "continue", output: `Search command failed: ${message}` };
      }
    },
    "Search the web (DuckDuckGo)"
  );

  registry.register(
    "fetch",
    async (args) => {
      const url = args.trim();
      if (url.length === 0) {
        return { action: "continue", output: "Usage: /fetch <url>" };
      }

      try {
        const output = await executeFetchSkill({ url });
        return { action: "continue", output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { action: "continue", output: `Fetch command failed: ${message}` };
      }
    },
    "Retrieve and display content from a URL"
  );

  registry.register(
    "memorize",
    async (args) => {
      const trimmed = args.trim();
      if (trimmed.length === 0 || trimmed.toLowerCase() === "help") {
        return { output: memorizeUsage, action: "continue" };
      }

      const tokens = trimmed.split(/\s+/u);
      const subcommand = (tokens[0] ?? "").toLowerCase();

      try {
        if (subcommand === "list") {
          const limitRaw = tokens[1] ?? "10";
          const limit = Number.parseInt(limitRaw, 10);
          if (!Number.isInteger(limit) || limit <= 0) {
            return { output: "Usage: /memorize list [positive_limit]", action: "continue" };
          }

          const memories = await listMemories(limit);
          if (memories.length === 0) {
            return { output: "No saved memories yet.", action: "continue" };
          }

          const lines = ["Saved memories:"];
          for (const memory of memories) {
            lines.push(`- ${memory.id}: ${memory.preview}`);
          }
          return { output: lines.join("\n"), action: "continue" };
        }

        if (subcommand === "read") {
          const memoryId = tokens.slice(1).join(" ").trim();
          if (memoryId.length === 0) {
            return { output: "Usage: /memorize read <memory_id>", action: "continue" };
          }

          const memory = await readMemory(memoryId);
          return {
            output: [`Memory ${memory.id}:`, memory.content].join("\n\n"),
            action: "continue"
          };
        }

        const saved = await saveMemory(trimmed);
        return {
          output: `Saved memory: ${saved.id}`,
          action: "continue"
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: `Memorize command failed: ${message}`, action: "continue" };
      }
    },
    "Save, list, and read long-term memories"
  );

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
