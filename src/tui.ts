/** Main TUI orchestrator using Ink. */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { getVersion } from "./version";

import { createDefaultRegistry, parseCommand } from "./commands";
import type { CommandRegistry, SessionContext } from "./commands";
import {
  colorText,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  INPUT_PINK
} from "./colors";
import { LlamaClient } from "./llama-client";
import {
  formatAssistantMessage,
  formatDimMessage,
  formatErrorMessage,
  formatUserMessage,
  formatWarningMessage
} from "./messages";
import { buildPromptBoxFrame } from "./prompt-box";
import {
  PromptComposer,
  type PromptComposerEvent,
  type PromptComposerLayout
} from "./prompt-composer";
import { InputEngine, type InputAction } from "./input-engine";
import { renderTitleBox } from "./title-box";
import type { TitleBoxOptions } from "./title-box";
import type { AppConfig, ChatMessage, TuiOptions } from "./types";

const PROMPT_PREFIX = ">>> ";
const CURSOR_MARKER = "▌";
const KEY_DEBUG_ENABLED = process.env["YIPS_DEBUG_KEYS"] === "1";

interface AssistantReply {
  text: string;
  rendered: boolean;
}

interface RuntimeState {
  outputLines: string[];
  running: boolean;
  config: AppConfig;
  messageCount: number;
  username: string;
  sessionName: string;
  inputHistory: string[];
  history: ChatMessage[];
  busy: boolean;
  busyLabel: string;
}

interface InkModule {
  render: (
    node: React.ReactNode,
    options?: { exitOnCtrlC?: boolean }
  ) => { waitUntilExit: () => Promise<void> };
  Box: React.ComponentType<{
    flexDirection?: "row" | "column";
    children?: React.ReactNode;
  }>;
  Text: React.ComponentType<{ children?: React.ReactNode }>;
  useApp: () => { exit: (error?: Error) => void };
  useStdin: () => {
    stdin: NodeJS.ReadStream;
    setRawMode: (value: boolean) => void;
    isRawModeSupported: boolean;
  };
  useStdout: () => {
    stdout: NodeJS.WriteStream;
    write: (data: string) => void;
  };
}

function formatBackendName(backend: string): string {
  return backend === "llamacpp" ? "llama.cpp" : backend;
}

function resolveLoadedModel(model: string): string | null {
  const trimmed = model.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}

function charLength(text: string): number {
  return Array.from(text).length;
}

function clipPromptStatusText(statusText: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const trimmed = statusText.trim();
  const normalized = trimmed.length > 0 ? ` ${trimmed} ` : " ";
  const chars = Array.from(normalized);
  if (chars.length <= maxWidth) return normalized;
  return chars.slice(chars.length - maxWidth).join("");
}

function toDebugText(input: string): string {
  return Array.from(input)
    .map((char) => {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return "";
      if (codePoint === 0x1b) return "<ESC>";
      if (codePoint === 0x0d) return "<CR>";
      if (codePoint === 0x0a) return "<LF>";
      if (codePoint === 0x08) return "<BS>";
      if (codePoint === 0x7f) return "<DEL>";
      if (codePoint < 0x20 || codePoint === 0x7f) {
        return `<0x${codePoint.toString(16).padStart(2, "0")}>`;
      }
      return char;
    })
    .join("");
}

function toDebugBytes(input: string): string {
  return Array.from(Buffer.from(input, "latin1"))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function buildTitleBoxOptions(
  state: RuntimeState,
  version: string,
  width: number
): TitleBoxOptions {
  const loadedModel = resolveLoadedModel(state.config.model);
  return {
    width,
    version,
    username: state.username,
    backend: formatBackendName(state.config.backend),
    model: loadedModel ?? "",
    tokenUsage: loadedModel ? "0/8192" : "",
    cwd: process.cwd(),
    sessionName: state.sessionName
  };
}

function buildPromptStatusText(state: RuntimeState): string {
  const provider = formatBackendName(state.config.backend);
  const loadedModel = resolveLoadedModel(state.config.model);
  const parts = [provider];
  if (loadedModel) {
    parts.push(loadedModel);
  }
  if (state.busy) {
    parts.push(state.busyLabel);
  }
  return parts.join(" · ");
}

function appendOutput(state: RuntimeState, text: string): void {
  const lines = text.split("\n");
  for (const line of lines) {
    state.outputLines.push(line);
  }
}

function replaceOutputBlock(
  state: RuntimeState,
  start: number,
  count: number,
  text: string
): number {
  const lines = text.split("\n");
  state.outputLines.splice(start, count, ...lines);
  return lines.length;
}

function resetSession(state: RuntimeState): void {
  state.outputLines = [];
  state.messageCount = 0;
  state.history = [];
}

function createRuntimeState(options: TuiOptions): RuntimeState {
  const modelOverride = options.model?.trim();
  const runtimeConfig: AppConfig = {
    ...options.config,
    model: modelOverride && modelOverride.length > 0 ? modelOverride : options.config.model
  };

  return {
    outputLines: [],
    running: true,
    config: runtimeConfig,
    messageCount: 0,
    username: options.username ?? process.env["USER"] ?? "user",
    sessionName: options.sessionName ?? "session",
    inputHistory: [],
    history: [],
    busy: false,
    busyLabel: ""
  };
}

function withCursorAt(content: string, index: number): string {
  const chars = Array.from(content);
  if (chars.length === 0) {
    return content;
  }
  const safeIndex = Math.max(0, Math.min(index, chars.length - 1));
  chars[safeIndex] = CURSOR_MARKER;
  return chars.join("");
}

interface VisibleLayoutSlices {
  titleLines: string[];
  outputLines: string[];
  promptLines: string[];
}

export function computeVisibleLayoutSlices(
  rows: number,
  titleLines: string[],
  outputLines: string[],
  promptLines: string[]
): VisibleLayoutSlices {
  const safeRows = Math.max(1, rows);
  const promptCount = Math.min(promptLines.length, safeRows);
  const visiblePrompt = promptLines.slice(-promptCount);
  const upperRowCount = Math.max(0, safeRows - visiblePrompt.length);

  if (upperRowCount === 0) {
    return {
      titleLines: [],
      outputLines: [],
      promptLines: visiblePrompt
    };
  }

  const stackedUpper = [...titleLines, ...outputLines];
  if (stackedUpper.length <= upperRowCount) {
    const outputPadding = new Array<string>(upperRowCount - stackedUpper.length).fill("");
    return {
      titleLines: [...titleLines],
      outputLines: [...outputPadding, ...outputLines],
      promptLines: visiblePrompt
    };
  }

  const upperTail = stackedUpper.slice(-upperRowCount);
  const titleBoundary = titleLines.length;
  const firstVisibleStackIndex = stackedUpper.length - upperTail.length;

  const visibleTitle: string[] = [];
  const visibleOutput: string[] = [];

  for (let offset = 0; offset < upperTail.length; offset++) {
    const line = upperTail[offset] ?? "";
    const stackIndex = firstVisibleStackIndex + offset;
    if (stackIndex < titleBoundary) {
      visibleTitle.push(line);
    } else {
      visibleOutput.push(line);
    }
  }

  return {
    titleLines: visibleTitle,
    outputLines: visibleOutput,
    promptLines: visiblePrompt
  };
}

export function buildPromptRenderLines(
  width: number,
  statusText: string,
  promptLayout: PromptComposerLayout,
  showCursor: boolean = true
): string[] {
  const frame = buildPromptBoxFrame(width, statusText, promptLayout.rowCount);

  const lines: string[] = [horizontalGradient(frame.top, GRADIENT_PINK, GRADIENT_YELLOW)];

  for (let rowIndex = 0; rowIndex < frame.middleRows.length; rowIndex++) {
    if (width <= 1) {
      lines.push(
        horizontalGradient(frame.middleRows[rowIndex] ?? "", GRADIENT_PINK, GRADIENT_YELLOW)
      );
      continue;
    }

    const prefix = rowIndex === 0 ? promptLayout.prefix : "";
    const contentChars = Array.from(`${prefix}${promptLayout.rows[rowIndex] ?? ""}`).slice(
      0,
      frame.innerWidth
    );
    while (contentChars.length < frame.innerWidth) {
      contentChars.push(" ");
    }

    let plainInner = contentChars.join("");
    if (showCursor && rowIndex === promptLayout.cursorRow && frame.innerWidth > 0) {
      const cursorOffset = rowIndex === 0 ? charLength(prefix) : 0;
      const cursorIndex = Math.max(
        0,
        Math.min(frame.innerWidth - 1, cursorOffset + promptLayout.cursorCol)
      );
      plainInner = withCursorAt(plainInner, cursorIndex);
    }

    const leftBorder = colorText("│", GRADIENT_PINK);
    const rightBorder = colorText("│", GRADIENT_YELLOW);

    const coloredInner = colorText(plainInner, INPUT_PINK);
    lines.push(`${leftBorder}${coloredInner}${rightBorder}`);
  }

  if (width <= 1) {
    lines.push(horizontalGradient(frame.bottom, GRADIENT_PINK, GRADIENT_YELLOW));
    return lines;
  }

  const clippedStatus = clipPromptStatusText(statusText, frame.innerWidth);
  const fill = "─".repeat(Math.max(0, frame.innerWidth - charLength(clippedStatus)));
  const leftBottom = colorText("╰", GRADIENT_PINK);
  const fillBottom = horizontalGradient(fill, GRADIENT_PINK, GRADIENT_YELLOW);
  const statusBottom = colorText(clippedStatus, GRADIENT_BLUE);
  const rightBottom = colorText("╯", GRADIENT_YELLOW);
  lines.push(`${leftBottom}${fillBottom}${statusBottom}${rightBottom}`);
  return lines;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatInputAction(action: InputAction): string {
  switch (action.type) {
    case "insert":
      return `insert(${JSON.stringify(action.text)})`;
    case "submit":
    case "newline":
    case "backspace":
    case "delete":
    case "move-left":
    case "move-right":
    case "move-up":
    case "move-down":
    case "home":
    case "end":
    case "cancel":
    case "tab":
      return action.type;
  }
}

function isAmbiguousPlainEnterChunk(sequence: string, actions: InputAction[]): boolean {
  if (!actions.some((action) => action.type === "submit")) {
    return false;
  }
  if (actions.some((action) => action.type === "newline")) {
    return false;
  }
  if (sequence.includes("\x1b")) {
    return false;
  }

  const bytes = Array.from(Buffer.from(sequence, "latin1"));
  if (bytes.length === 1 && bytes[0] === 0x0d) {
    return true;
  }
  if (bytes.length === 2 && bytes[0] === 0x0d && bytes[1] === 0x0a) {
    return true;
  }

  return false;
}

function applyInputAction(
  composer: PromptComposer,
  action: InputAction
): PromptComposerEvent | null {
  switch (action.type) {
    case "insert":
      for (const char of Array.from(action.text)) {
        composer.handleKey(char, { isCharacter: true });
      }
      return null;
    case "newline":
      return composer.handleKey("CTRL_ENTER");
    case "submit":
      return composer.handleKey("ENTER");
    case "backspace":
      return composer.handleKey("BACKSPACE");
    case "delete":
      return composer.handleKey("DELETE");
    case "move-left":
      return composer.handleKey("LEFT");
    case "move-right":
      return composer.handleKey("RIGHT");
    case "move-up":
      return composer.handleKey("UP");
    case "move-down":
      return composer.handleKey("DOWN");
    case "home":
      return composer.handleKey("HOME");
    case "end":
      return composer.handleKey("END");
    case "tab":
      return null;
    case "cancel":
      return { type: "cancel" };
  }
}

interface InkAppProps {
  options: TuiOptions;
  version: string;
  ink: InkModule;
}

function createInkApp(ink: InkModule): React.FC<Omit<InkAppProps, "ink">> {
  const { Box, Text, useApp, useStdin, useStdout } = ink;

  return function InkApp({ options, version }) {
    const { exit } = useApp();
    const { stdin, isRawModeSupported, setRawMode } = useStdin();
    const { stdout } = useStdout();

    const [dimensions, setDimensions] = useState(() => ({
      columns: stdout.columns ?? 80,
      rows: stdout.rows ?? 24
    }));
    const [, setRenderVersion] = useState(0);

    const stateRef = useRef<RuntimeState | null>(null);
    const registryRef = useRef<CommandRegistry>(createDefaultRegistry());
    const composerRef = useRef<PromptComposer | null>(null);
    const llamaClientRef = useRef<LlamaClient | null>(null);
    const inputEngineRef = useRef<InputEngine>(new InputEngine());
    const dimensionsRef = useRef(dimensions);

    const forceRender = useCallback(() => {
      setRenderVersion((value) => value + 1);
    }, []);

    dimensionsRef.current = dimensions;

    if (!stateRef.current) {
      const state = createRuntimeState(options);
      stateRef.current = state;
    }

    const state = stateRef.current;

    if (!llamaClientRef.current) {
      llamaClientRef.current = new LlamaClient({
        baseUrl: state.config.llamaBaseUrl,
        model: state.config.model
      });
    }

    const createComposer = useCallback((): PromptComposer => {
      const currentState = stateRef.current;
      if (!currentState) {
        throw new Error("Runtime state is not initialized.");
      }

      return new PromptComposer({
        interiorWidth: Math.max(0, dimensionsRef.current.columns - 2),
        history: [...currentState.inputHistory],
        autoComplete: registryRef.current.getNames().map((name) => `/${name}`),
        prefix: PROMPT_PREFIX
      });
    }, []);

    if (!composerRef.current) {
      composerRef.current = createComposer();
    }

    useEffect(() => {
      return () => {
        inputEngineRef.current.reset();
      };
    }, []);

    useEffect(() => {
      const onResize = (): void => {
        const next = {
          columns: stdout.columns ?? 80,
          rows: stdout.rows ?? 24
        };
        setDimensions(next);
      };

      stdout.on("resize", onResize);
      return () => {
        stdout.off("resize", onResize);
      };
    }, [stdout]);

    useEffect(() => {
      const composer = composerRef.current;
      if (!composer) return;
      composer.setInteriorWidth(Math.max(0, dimensions.columns - 2));
      forceRender();
    }, [dimensions.columns, forceRender]);

    useEffect(() => {
      if (!isRawModeSupported) {
        return;
      }

      setRawMode(true);
      return () => {
        setRawMode(false);
      };
    }, [isRawModeSupported, setRawMode]);

    const requestAssistantFromLlama = useCallback(async (): Promise<AssistantReply> => {
      const currentState = stateRef.current;
      const llamaClient = llamaClientRef.current;
      if (!currentState || !llamaClient) {
        throw new Error("Chat runtime is not initialized.");
      }

      llamaClient.setModel(currentState.config.model);

      if (!currentState.config.streaming) {
        currentState.busy = true;
        currentState.busyLabel = "Thinking...";
        forceRender();

        try {
          const text = await llamaClient.chat(currentState.history, currentState.config.model);
          return { text, rendered: false };
        } finally {
          currentState.busy = false;
          currentState.busyLabel = "";
          forceRender();
        }
      }

      const timestamp = new Date();
      let streamText = "";
      const blockStart = currentState.outputLines.length;
      let blockLength = 1;
      appendOutput(currentState, formatAssistantMessage("", timestamp));
      forceRender();

      try {
        streamText = await llamaClient.streamChat(
          currentState.history,
          {
            onToken: (token: string): void => {
              streamText += token;
              blockLength = replaceOutputBlock(
                currentState,
                blockStart,
                blockLength,
                formatAssistantMessage(streamText, timestamp)
              );
              forceRender();
            }
          },
          currentState.config.model
        );

        if (streamText.length === 0) {
          throw new Error("Streaming response ended without assistant content.");
        }

        return { text: streamText, rendered: true };
      } catch {
        appendOutput(
          currentState,
          formatWarningMessage("Streaming failed. Retrying without streaming.")
        );
        currentState.busy = true;
        currentState.busyLabel = "Retrying...";
        forceRender();

        try {
          const fallbackText = await llamaClient.chat(
            currentState.history,
            currentState.config.model
          );
          replaceOutputBlock(
            currentState,
            blockStart,
            blockLength,
            formatAssistantMessage(fallbackText, timestamp)
          );
          return { text: fallbackText, rendered: true };
        } catch (fallbackError) {
          currentState.outputLines.splice(blockStart, blockLength);
          throw fallbackError;
        } finally {
          currentState.busy = false;
          currentState.busyLabel = "";
          forceRender();
        }
      }
    }, [forceRender]);

    const handleUserMessage = useCallback(
      async (text: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }

        currentState.messageCount += 1;
        appendOutput(currentState, formatUserMessage(text));
        currentState.history.push({ role: "user", content: text });
        forceRender();

        if (currentState.config.backend !== "llamacpp") {
          const echo = `Echo: ${text}`;
          appendOutput(
            currentState,
            formatWarningMessage(
              `Backend '${currentState.config.backend}' is not implemented yet. Using echo.`
            )
          );
          appendOutput(currentState, formatAssistantMessage(echo));
          appendOutput(currentState, "");
          currentState.history.push({ role: "assistant", content: echo });
          forceRender();
          return;
        }

        try {
          const reply = await requestAssistantFromLlama();
          if (!reply.rendered) {
            appendOutput(currentState, formatAssistantMessage(reply.text));
          }
          currentState.history.push({ role: "assistant", content: reply.text });
          appendOutput(currentState, "");
        } catch (error) {
          appendOutput(currentState, formatErrorMessage(`Request failed: ${formatError(error)}`));
          appendOutput(currentState, "");
        }

        forceRender();
      },
      [forceRender, requestAssistantFromLlama]
    );

    const processSubmittedInput = useCallback(
      async (input: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }

        composerRef.current = createComposer();
        forceRender();

        const trimmed = input.trim();
        if (trimmed.length === 0) return;

        currentState.inputHistory.push(trimmed);

        const parsed = parseCommand(trimmed);

        if (parsed) {
          const context: SessionContext = {
            config: currentState.config,
            messageCount: currentState.messageCount
          };
          const result = registryRef.current.dispatch(parsed.command, parsed.args, context);

          if (result.output) {
            appendOutput(currentState, formatDimMessage(result.output));
            appendOutput(currentState, "");
          }

          if (result.action === "clear") {
            resetSession(currentState);
          }

          forceRender();

          if (result.action === "exit") {
            currentState.running = false;
            exit();
          }

          return;
        }

        await handleUserMessage(trimmed);
      },
      [createComposer, exit, forceRender, handleUserMessage]
    );

    const dispatchComposerEvent = useCallback(
      (event: PromptComposerEvent): void => {
        const composer = composerRef.current;

        if (event.type === "submit") {
          void processSubmittedInput(event.value);
          return;
        }

        if (event.type === "cancel") {
          const currentState = stateRef.current;
          if (currentState) {
            currentState.running = false;
          }
          exit();
          return;
        }

        if (event.type === "autocomplete-menu") {
          const firstOption = event.options[0];
          if (composer && firstOption) {
            composer.applyAutocompleteChoice(event.tokenStart, event.tokenEnd, firstOption);
          }
        }

        forceRender();
      },
      [exit, forceRender, processSubmittedInput]
    );

    useEffect(() => {
      const onData = (chunk: Buffer | string): void => {
        const currentState = stateRef.current;
        const composer = composerRef.current;
        if (!currentState || !composer) {
          return;
        }

        const sequence = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk);
        const actions = inputEngineRef.current.pushChunk(chunk);

        if (KEY_DEBUG_ENABLED) {
          const actionSummary = actions.map(formatInputAction).join(", ");
          appendOutput(
            currentState,
            formatDimMessage(
              `[debug stdin] bytes=${toDebugBytes(sequence)} text=${toDebugText(sequence)} actions=[${actionSummary}]`
            )
          );
          if (isAmbiguousPlainEnterChunk(sequence, actions)) {
            appendOutput(
              currentState,
              formatWarningMessage(
                "Terminal emitted plain CR for submit; Ctrl+Enter may be indistinguishable from Enter in this terminal config."
              )
            );
          }
          forceRender();
        }

        if (actions.length === 0) {
          return;
        }

        composer.setInteriorWidth(Math.max(0, dimensionsRef.current.columns - 2));

        let shouldRender = false;

        for (const action of actions) {
          if (action.type === "cancel") {
            currentState.running = false;
            exit();
            return;
          }

          if (currentState.busy) {
            continue;
          }

          const event = applyInputAction(composer, action);
          if (!event) {
            shouldRender = true;
            continue;
          }

          if (event.type === "none") {
            shouldRender = true;
            continue;
          }

          dispatchComposerEvent(event);
          return;
        }

        if (shouldRender) {
          forceRender();
        }
      };

      stdin.on("data", onData);
      return () => {
        stdin.off("data", onData);
      };
    }, [dispatchComposerEvent, exit, forceRender, stdin]);

    const composer = composerRef.current;
    composer.setInteriorWidth(Math.max(0, dimensions.columns - 2));
    const promptLayout = composer.getLayout();

    const statusText = buildPromptStatusText(state);

    const titleLines = renderTitleBox(buildTitleBoxOptions(state, version, dimensions.columns));
    const promptLines = buildPromptRenderLines(dimensions.columns, statusText, promptLayout, true);
    const visible = computeVisibleLayoutSlices(
      dimensions.rows,
      titleLines,
      state.outputLines,
      promptLines
    );

    const titleNodes = visible.titleLines.map((line, index) =>
      React.createElement(Text, { key: `title-${index}` }, line.length > 0 ? line : " ")
    );

    const outputNodes = visible.outputLines.map((line, index) =>
      React.createElement(Text, { key: `out-${index}` }, line.length > 0 ? line : " ")
    );

    const promptNodes = visible.promptLines.map((line, index) =>
      React.createElement(Text, { key: `prompt-${index}` }, line)
    );

    return React.createElement(
      Box,
      { flexDirection: "column" },
      ...titleNodes,
      ...outputNodes,
      ...promptNodes
    );
  };
}

export async function startTui(options: TuiOptions): Promise<void> {
  const version = await getVersion();
  const ink = (await import("ink")) as unknown as InkModule;
  const App = createInkApp(ink);
  const instance = ink.render(React.createElement(App, { options, version }), {
    exitOnCtrlC: false
  });

  await instance.waitUntilExit();
}
