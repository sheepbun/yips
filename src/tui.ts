/** Main TUI orchestrator using terminal-kit alternate screen. */

import terminalKit from "terminal-kit";

import { colorText, DARK_BLUE, GRADIENT_PINK, GRADIENT_YELLOW, horizontalGradient } from "./colors";
import { createDefaultRegistry, parseCommand } from "./commands";
import type { CommandRegistry, SessionContext } from "./commands";
import { formatAssistantMessage, formatDimMessage, formatUserMessage } from "./messages";
import { PulsingSpinner } from "./spinner";
import { renderTitleBox } from "./title-box";
import type { TitleBoxOptions } from "./title-box";
import type { AppConfig } from "./types";

export interface TuiOptions {
  config: AppConfig;
  username?: string;
  model?: string;
  sessionName?: string;
}

interface TuiState {
  outputLines: string[];
  scrollOffset: number;
  running: boolean;
  config: AppConfig;
  messageCount: number;
  username: string;
  model: string;
  sessionName: string;
  inputHistory: string[];
}

const term = terminalKit.terminal;

function getOutputAreaHeight(): number {
  return Math.max(1, term.height - 3);
}

function renderOutputArea(state: TuiState): void {
  const areaHeight = getOutputAreaHeight();
  const visibleStart = Math.max(0, state.outputLines.length - areaHeight - state.scrollOffset);

  for (let row = 0; row < areaHeight; row++) {
    const lineIndex = visibleStart + row;
    term.moveTo(1, row + 1);
    term.eraseLine();
    if (lineIndex < state.outputLines.length) {
      term.markupOnly(state.outputLines[lineIndex]!);
    }
  }
}

function renderStatusBar(state: TuiState, spinner: PulsingSpinner): void {
  const y = term.height - 1;
  term.moveTo(1, y);
  term.eraseLine();

  const separator = horizontalGradient("─".repeat(term.width), GRADIENT_PINK, GRADIENT_YELLOW);
  term.markupOnly(separator);

  term.moveTo(1, y);
  const statusLeft = `${state.config.backend} · ${state.model} · ${state.messageCount} msgs`;
  const statusContent = spinner.isActive()
    ? `${colorText(statusLeft, DARK_BLUE)}  ${spinner.render()}`
    : colorText(statusLeft, DARK_BLUE);

  term.markupOnly(` ${statusContent}`);
}

function renderInputLine(): void {
  const y = term.height;
  term.moveTo(1, y);
  term.eraseLine();
  term.markupOnly(colorText(">>> ", GRADIENT_PINK));
}

function appendOutput(state: TuiState, text: string): void {
  const lines = text.split("\n");
  for (const line of lines) {
    state.outputLines.push(line);
  }
}

function renderAll(state: TuiState, spinner: PulsingSpinner): void {
  renderOutputArea(state);
  renderStatusBar(state, spinner);
  renderInputLine();
}

function buildTitleBoxOptions(state: TuiState, version: string): TitleBoxOptions {
  return {
    width: term.width,
    version,
    username: state.username,
    backend: state.config.backend,
    model: state.model,
    tokenUsage: "0/8192",
    cwd: process.cwd(),
    sessionName: state.sessionName
  };
}

export async function startTui(options: TuiOptions): Promise<void> {
  const state: TuiState = {
    outputLines: [],
    scrollOffset: 0,
    running: true,
    config: options.config,
    messageCount: 0,
    username: options.username ?? process.env["USER"] ?? "user",
    model: options.model ?? "default",
    sessionName: options.sessionName ?? "session",
    inputHistory: []
  };

  const spinner = new PulsingSpinner();
  const registry: CommandRegistry = createDefaultRegistry();
  const version = "0.1.0";

  term.fullscreen(true);
  term.grabInput({ mouse: "button" });

  const titleLines = renderTitleBox(buildTitleBoxOptions(state, version));
  for (const line of titleLines) {
    appendOutput(state, line);
  }
  appendOutput(state, "");
  appendOutput(
    state,
    formatAssistantMessage("Welcome! Type /help for commands, or start chatting.")
  );
  appendOutput(state, "");

  renderAll(state, spinner);

  term.on("key", (key: string) => {
    if (key === "CTRL_C") {
      shutdown();
    }
  });

  function shutdown(): void {
    state.running = false;
    term.grabInput(false);
    term.fullscreen(false);
    term.styleReset("\n");
    process.exit(0);
  }

  function getContext(): SessionContext {
    return {
      config: state.config,
      messageCount: state.messageCount
    };
  }

  while (state.running) {
    renderAll(state, spinner);

    const inputY = term.height;
    term.moveTo(5, inputY);

    const { promise } = term.inputField({
      cancelable: true,
      history: state.inputHistory,
      autoComplete: registry.getNames().map((n) => `/${n}`),
      autoCompleteMenu: true
    } as terminalKit.Terminal.InputFieldOptions);

    const input = await promise;

    if (input === undefined) {
      shutdown();
      return;
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) continue;

    state.inputHistory.push(trimmed);

    const parsed = parseCommand(trimmed);

    if (parsed) {
      const result = registry.dispatch(parsed.command, parsed.args, getContext());

      if (result.output) {
        appendOutput(state, formatDimMessage(result.output));
        appendOutput(state, "");
      }

      if (result.action === "exit") {
        shutdown();
        return;
      }

      if (result.action === "clear") {
        state.outputLines = [];
        const titleLines2 = renderTitleBox(buildTitleBoxOptions(state, version));
        for (const line of titleLines2) {
          appendOutput(state, line);
        }
        appendOutput(state, "");
      }
    } else {
      state.messageCount += 1;
      appendOutput(state, formatUserMessage(trimmed));
      appendOutput(state, formatAssistantMessage(`Echo: ${trimmed}`));
      appendOutput(state, "");
    }
  }
}

/** Handle terminal resize events. */
function setupResizeHandler(state: TuiState, spinner: PulsingSpinner): void {
  term.on("resize", () => {
    renderAll(state, spinner);
  });
}

export { setupResizeHandler };
