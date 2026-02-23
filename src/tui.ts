/** Main TUI orchestrator using terminal-kit alternate screen. */

import terminalKit from "terminal-kit";

import {
  colorText,
  DARK_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  INPUT_PINK
} from "./colors";
import { createDefaultRegistry, parseCommand } from "./commands";
import type { CommandRegistry, SessionContext } from "./commands";
import { LlamaClient } from "./llama-client";
import {
  formatAssistantMessage,
  formatDimMessage,
  formatErrorMessage,
  formatUserMessage,
  formatWarningMessage
} from "./messages";
import { PulsingSpinner } from "./spinner";
import { renderTitleBox } from "./title-box";
import type { TitleBoxOptions } from "./title-box";
import type { AppConfig, ChatMessage, TuiOptions } from "./types";

interface TuiState {
  outputLines: string[];
  scrollOffset: number;
  running: boolean;
  config: AppConfig;
  messageCount: number;
  username: string;
  sessionName: string;
  inputHistory: string[];
  history: ChatMessage[];
}

interface AssistantReply {
  text: string;
  rendered: boolean;
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
  const statusLeft = `${state.config.backend} · ${state.config.model}`;
  const statusContent = spinner.isActive()
    ? `${colorText(statusLeft, DARK_BLUE)}  ${spinner.render()}`
    : colorText(statusLeft, DARK_BLUE);

  term.markupOnly(` ${statusContent}`);
}

function renderInputLine(): void {
  const y = term.height;
  term.moveTo(1, y);
  term.eraseLine();
  term.markupOnly(colorText(">>> ", INPUT_PINK));
}

function appendOutput(state: TuiState, text: string): void {
  const lines = text.split("\n");
  for (const line of lines) {
    state.outputLines.push(line);
  }
}

function replaceOutputBlock(state: TuiState, start: number, count: number, text: string): number {
  const lines = text.split("\n");
  state.outputLines.splice(start, count, ...lines);
  return lines.length;
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
    model: state.config.model,
    tokenUsage: "0/8192",
    cwd: process.cwd(),
    sessionName: state.sessionName
  };
}

function appendSessionHeader(state: TuiState, version: string): void {
  appendOutput(state, "");
  const titleLines = renderTitleBox(buildTitleBoxOptions(state, version));
  for (const line of titleLines) {
    appendOutput(state, line);
  }
  appendOutput(state, "");
}

function resetSession(state: TuiState, version: string): void {
  state.outputLines = [];
  state.scrollOffset = 0;
  state.messageCount = 0;
  state.history = [];
  appendSessionHeader(state, version);
}

async function withSpinner<T>(
  state: TuiState,
  spinner: PulsingSpinner,
  label: string,
  task: () => Promise<T>
): Promise<T> {
  spinner.start(label);
  const interval = setInterval(() => {
    if (state.running) {
      renderAll(state, spinner);
    }
  }, 90);
  renderAll(state, spinner);

  try {
    return await task();
  } finally {
    clearInterval(interval);
    spinner.stop();
    renderAll(state, spinner);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startTui(options: TuiOptions): Promise<void> {
  const modelOverride = options.model?.trim();
  const runtimeConfig: AppConfig = {
    ...options.config,
    model: modelOverride && modelOverride.length > 0 ? modelOverride : options.config.model
  };

  const state: TuiState = {
    outputLines: [],
    scrollOffset: 0,
    running: true,
    config: runtimeConfig,
    messageCount: 0,
    username: options.username ?? process.env["USER"] ?? "user",
    sessionName: options.sessionName ?? "session",
    inputHistory: [],
    history: []
  };

  const spinner = new PulsingSpinner();
  const registry: CommandRegistry = createDefaultRegistry();
  const version = "0.1.0";
  const llamaClient = new LlamaClient({
    baseUrl: state.config.llamaBaseUrl,
    model: state.config.model
  });

  term.fullscreen(true);
  term.grabInput({ mouse: "button" });

  appendSessionHeader(state, version);
  renderAll(state, spinner);
  setupResizeHandler(state, spinner);

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

  async function requestAssistantFromLlama(): Promise<AssistantReply> {
    llamaClient.setModel(state.config.model);

    if (!state.config.streaming) {
      const text = await withSpinner(state, spinner, "Thinking...", async () =>
        llamaClient.chat(state.history, state.config.model)
      );
      return { text, rendered: false };
    }

    const timestamp = new Date();
    let streamText = "";
    const blockStart = state.outputLines.length;
    let blockLength = 1;
    appendOutput(state, formatAssistantMessage("", timestamp));
    renderAll(state, spinner);

    try {
      streamText = await llamaClient.streamChat(
        state.history,
        {
          onToken: (token: string) => {
            streamText += token;
            blockLength = replaceOutputBlock(
              state,
              blockStart,
              blockLength,
              formatAssistantMessage(streamText, timestamp)
            );
            renderAll(state, spinner);
          }
        },
        state.config.model
      );

      if (streamText.length === 0) {
        throw new Error("Streaming response ended without assistant content.");
      }

      return { text: streamText, rendered: true };
    } catch {
      appendOutput(state, formatWarningMessage("Streaming failed. Retrying without streaming."));
      renderAll(state, spinner);

      try {
        const fallbackText = await withSpinner(state, spinner, "Retrying...", async () =>
          llamaClient.chat(state.history, state.config.model)
        );
        replaceOutputBlock(
          state,
          blockStart,
          blockLength,
          formatAssistantMessage(fallbackText, timestamp)
        );
        renderAll(state, spinner);
        return { text: fallbackText, rendered: true };
      } catch (fallbackError) {
        state.outputLines.splice(blockStart, blockLength);
        throw fallbackError;
      }
    }
  }

  async function handleUserMessage(text: string): Promise<void> {
    state.messageCount += 1;
    appendOutput(state, formatUserMessage(text));
    renderAll(state, spinner);

    state.history.push({ role: "user", content: text });

    if (state.config.backend !== "llamacpp") {
      const echo = `Echo: ${text}`;
      appendOutput(
        state,
        formatWarningMessage(
          `Backend '${state.config.backend}' is not implemented yet. Using echo.`
        )
      );
      appendOutput(state, formatAssistantMessage(echo));
      appendOutput(state, "");
      state.history.push({ role: "assistant", content: echo });
      renderAll(state, spinner);
      return;
    }

    try {
      const reply = await requestAssistantFromLlama();
      if (!reply.rendered) {
        appendOutput(state, formatAssistantMessage(reply.text));
      }
      state.history.push({ role: "assistant", content: reply.text });
      appendOutput(state, "");
    } catch (error) {
      appendOutput(state, formatErrorMessage(`Request failed: ${formatError(error)}`));
      appendOutput(state, "");
    }

    renderAll(state, spinner);
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
        resetSession(state, version);
      }
    } else {
      await handleUserMessage(trimmed);
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
