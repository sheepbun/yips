import { stdin, stdout } from "node:process";

import { loadConfig } from "./config";
import { startRepl } from "./repl";
import { startTui } from "./tui";

function isTTY(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export async function main(): Promise<void> {
  for (;;) {
    const configResult = await loadConfig();

    if (configResult.warning) {
      console.error(`[warning] ${configResult.warning}`);
    }

    const result =
      hasFlag("--no-tui") || !isTTY()
        ? await startRepl({ config: configResult.config })
        : await startTui({ config: configResult.config });

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
