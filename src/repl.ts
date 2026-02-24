import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import type { ReplAction, ReplOptions, SessionState } from "./types";

export function renderHelpText(): string {
  return [
    "Available commands:",
    "  /help  - Show this help",
    "  /exit  - Exit the REPL",
    "  /restart  - Restart Yips",
    "  /quit  - Exit the REPL"
  ].join("\n");
}

export function handleInput(input: string, state: SessionState): ReplAction {
  if (!state.running) {
    return { type: "exit" };
  }

  const trimmed = input.trim();

  if (trimmed.startsWith("/")) {
    const [commandToken = ""] = trimmed.split(/\s+/, 1);
    const normalizedCommand = commandToken.toLowerCase();

    if (normalizedCommand === "/help") {
      return { type: "help" };
    }

    if (normalizedCommand === "/exit" || normalizedCommand === "/quit") {
      return { type: "exit" };
    }

    if (normalizedCommand === "/restart") {
      return { type: "restart" };
    }

    return { type: "unknown", command: normalizedCommand.slice(1) };
  }

  return { type: "echo", text: input };
}

function streamIsTTY(stream: unknown): boolean {
  if (typeof stream !== "object" || stream === null || !("isTTY" in stream)) {
    return false;
  }

  return (stream as { isTTY: unknown }).isTTY === true;
}

function writeLine(output: NodeJS.WritableStream, message: string): void {
  output.write(`${message}\n`);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected action: ${JSON.stringify(value)}`);
}

export function applyAction(
  action: ReplAction,
  state: SessionState,
  output: NodeJS.WritableStream
): void {
  switch (action.type) {
    case "help":
      writeLine(output, renderHelpText());
      return;
    case "exit":
      state.running = false;
      writeLine(output, "Goodbye.");
      return;
    case "restart":
      state.running = false;
      writeLine(output, "Restarting Yips.");
      return;
    case "echo":
      if (action.text.trim().length > 0) {
        state.messageCount += 1;
        writeLine(output, `Yips: ${action.text}`);
      }
      return;
    case "unknown":
      writeLine(output, `Unknown command: /${action.command}. Type /help for help.`);
      return;
    default:
      assertNever(action);
  }
}

export async function startRepl(options: ReplOptions): Promise<"exit" | "restart"> {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const prompt = options.prompt ?? "> ";
  const terminal = streamIsTTY(input) && streamIsTTY(output);

  const state: SessionState = {
    messageCount: 0,
    running: true,
    config: options.config
  };

  writeLine(output, "Yips Milestone 0 REPL");
  writeLine(output, "Type /help for commands.");

  const readline = createInterface({ input, output, terminal });
  let restartRequested = false;

  try {
    while (state.running) {
      const inputLine = await readline.question(prompt);
      const action = handleInput(inputLine, state);
      if (action.type === "restart") {
        restartRequested = true;
      }
      applyAction(action, state, output);
    }
  } finally {
    readline.close();
  }

  return restartRequested ? "restart" : "exit";
}
