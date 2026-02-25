#!/usr/bin/env node

import { stdin, stdout } from "node:process";

import { loadConfig } from "#config/config";
import { startRepl } from "#app/repl";
import { startBackgroundGateway } from "#gateway/background";
import { startTui } from "#ui/tui/start-tui";

function isTTY(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export async function main(): Promise<void> {
  for (;;) {
    const configResult = await loadConfig();
    const backgroundGateway = await startBackgroundGateway({
      config: configResult.config,
      logger: console
    }).catch((error: unknown) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`[warning] Background gateway failed to start: ${message}`);
      return {
        active: false,
        stop: async (): Promise<void> => {}
      };
    });

    if (configResult.warning) {
      console.error(`[warning] ${configResult.warning}`);
    }

    let result: "exit" | "restart";
    try {
      result =
        hasFlag("--no-tui") || !isTTY()
          ? await startRepl({ config: configResult.config })
          : await startTui({ config: configResult.config });
    } finally {
      await backgroundGateway.stop();
    }

    if (result !== "restart") {
      break;
    }
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[fatal] ${message}`);
    process.exitCode = 1;
  });
}
