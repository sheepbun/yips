import { buildPromptBoxFrame } from "#ui/prompt/prompt-box";
import type { PromptComposerLayout } from "#ui/prompt/prompt-composer";
import { colorText, GRADIENT_BLUE, GRADIENT_PINK, GRADIENT_YELLOW, horizontalGradient, horizontalGradientAtOffset, INPUT_PINK } from "#ui/colors";

import { CURSOR_MARKER, TITLE_OUTPUT_GAP_ROWS, ANSI_SGR_PATTERN } from "#ui/tui/constants";
import { formatTokensPerSecond } from "#ui/tui/runtime-utils";
import { getFriendlyModelName } from "#models/model-manager";

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

function withCursorAt(content: string, index: number): string {
  const chars = Array.from(content);
  if (chars.length === 0) {
    return content;
  }
  const safeIndex = Math.max(0, Math.min(index, chars.length - 1));
  chars[safeIndex] = CURSOR_MARKER;
  return chars.join("");
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}

function isVisuallyEmptyLine(line: string): boolean {
  return stripAnsi(line).trim().length === 0;
}

function visibleCharLength(line: string): number {
  return Array.from(stripAnsi(line)).length;
}

function inferRenderWidth(titleLines: readonly string[], promptLines: readonly string[]): number {
  const candidates = [...titleLines, ...promptLines]
    .map((line) => visibleCharLength(line))
    .filter((length) => length > 0);
  if (candidates.length === 0) {
    return 80;
  }
  return Math.max(1, ...candidates);
}

function lineDisplayRows(line: string, width: number): number {
  const safeWidth = Math.max(1, width);
  const length = visibleCharLength(line);
  if (length <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(length / safeWidth));
}

function countDisplayRows(lines: readonly string[], width: number): number {
  return lines.reduce((total, line) => total + lineDisplayRows(line, width), 0);
}

function trimEndByDisplayRows(line: string, rowsToTrim: number, width: number): string {
  if (rowsToTrim <= 0) {
    return line;
  }
  const safeWidth = Math.max(1, width);
  const plainChars = Array.from(stripAnsi(line));
  if (plainChars.length === 0) {
    return "";
  }
  const nextLength = Math.max(0, plainChars.length - rowsToTrim * safeWidth);
  return plainChars.slice(0, nextLength).join("");
}

function dropLeadingByDisplayRows(
  lines: readonly string[],
  rowsToDrop: number,
  width: number
): string[] {
  if (rowsToDrop <= 0 || lines.length === 0) {
    return [...lines];
  }
  let index = 0;
  let remaining = rowsToDrop;
  while (index < lines.length && remaining > 0) {
    remaining -= lineDisplayRows(lines[index] ?? "", width);
    index += 1;
  }
  return lines.slice(index);
}

function dropTrailingByDisplayRows(
  lines: readonly string[],
  rowsToDrop: number,
  width: number
): string[] {
  if (rowsToDrop <= 0 || lines.length === 0) {
    return [...lines];
  }
  const next = [...lines];
  let remaining = rowsToDrop;

  while (next.length > 0 && remaining > 0) {
    const lastIndex = next.length - 1;
    const lastLine = next[lastIndex] ?? "";
    const lastRows = lineDisplayRows(lastLine, width);
    if (remaining >= lastRows) {
      remaining -= lastRows;
      next.pop();
      continue;
    }
    next[lastIndex] = trimEndByDisplayRows(lastLine, remaining, width);
    remaining = 0;
  }

  return next;
}

function computeMinVisibleContentRows(outputLines: readonly string[], width: number): number {
  const firstContentIndex = outputLines.findIndex((line) => !isVisuallyEmptyLine(line));
  if (firstContentIndex === -1) {
    return 0;
  }
  const rowsBeforeFirstContent = countDisplayRows(outputLines.slice(0, firstContentIndex), width);
  return rowsBeforeFirstContent + 1;
}

function computeMaxOutputScrollOffsetRows(outputLines: readonly string[], width: number): number {
  const totalRows = countDisplayRows(outputLines, width);
  const minVisibleRows = computeMinVisibleContentRows(outputLines, width);
  return Math.max(0, totalRows - minVisibleRows);
}

function computeUsefulOutputScrollCapRows(options: {
  rows: number;
  titleLines: readonly string[];
  outputLines: readonly string[];
  promptLines: readonly string[];
  width: number;
}): number {
  const structuralMax = computeMaxOutputScrollOffsetRows(options.outputLines, options.width);
  const safeRows = Math.max(1, options.rows);
  const promptCount = Math.min(options.promptLines.length, safeRows);
  const upperRowCount = Math.max(0, safeRows - promptCount);
  const topVisibleTitleCount = Math.min(options.titleLines.length, upperRowCount);
  const topGapRows = topVisibleTitleCount > 0 ? TITLE_OUTPUT_GAP_ROWS : 0;
  const topContentRows = Math.max(0, upperRowCount - topVisibleTitleCount - topGapRows);
  const extraRowsBeyondAnchor = Math.max(0, topContentRows - 1);
  return Math.max(0, structuralMax - extraRowsBeyondAnchor);
}

export interface PromptStatusState {
  uiMode: "chat" | "downloader" | "model-manager" | "setup" | "sessions" | "vt" | "confirm";
  config: {
    backend: string;
    model: string;
    nicknames: Record<string, string>;
  };
  latestOutputTokensPerSecond: number | null;
  outputScrollOffset: number;
}

export function buildPromptStatusText(state: PromptStatusState): string {
  if (state.uiMode === "confirm") {
    return "confirmation · required";
  }
  if (state.uiMode === "vt") {
    return "virtual-terminal · active";
  }
  if (state.uiMode === "sessions") {
    return "sessions · browse";
  }
  if (state.uiMode === "model-manager") {
    return "model-manager · search";
  }
  if (state.uiMode === "setup") {
    return "setup · channels";
  }
  if (state.uiMode === "downloader") {
    return "model-downloader · search";
  }
  const provider = formatBackendName(state.config.backend);
  const loadedModel = resolveLoadedModel(state.config.model);
  const parts = [provider];
  if (loadedModel) {
    parts.push(getFriendlyModelName(loadedModel, state.config.nicknames));
    if (
      typeof state.latestOutputTokensPerSecond === "number" &&
      state.latestOutputTokensPerSecond > 0
    ) {
      parts.push(formatTokensPerSecond(state.latestOutputTokensPerSecond));
    }
  }
  const status = parts.join(" · ");
  if (state.outputScrollOffset > 0) {
    return `${status} · scroll +${state.outputScrollOffset}`;
  }
  return status;
}

export function composeOutputLines(options: {
  outputLines: string[];
  autocompleteOverlay: string[];
  busyLine?: string;
}): string[] {
  const lines = [...options.outputLines, ...options.autocompleteOverlay];
  if (options.busyLine && options.busyLine.length > 0) {
    lines.push(options.busyLine);
  }
  return lines;
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
  promptLines: string[],
  outputScrollOffset = 0
): VisibleLayoutSlices {
  const safeRows = Math.max(1, rows);
  const promptCount = Math.min(promptLines.length, safeRows);
  const visiblePrompt = promptLines.slice(-promptCount);
  const upperRowCount = Math.max(0, safeRows - visiblePrompt.length);
  const renderWidth = inferRenderWidth(titleLines, visiblePrompt);

  if (upperRowCount === 0) {
    return {
      titleLines: [],
      outputLines: [],
      promptLines: visiblePrompt
    };
  }

  const baseHiddenTitle = Math.max(0, titleLines.length - upperRowCount);
  const initiallyVisibleTitleCount = titleLines.length - baseHiddenTitle;
  const maxOffset = computeUsefulOutputScrollCapRows({
    rows: safeRows,
    titleLines,
    outputLines,
    promptLines: visiblePrompt,
    width: renderWidth
  });
  const clampedOffset = Math.max(0, Math.min(outputScrollOffset, maxOffset));
  const isAtTopOfScrollback = maxOffset > 0 && clampedOffset === maxOffset;
  const reservedTitleGap =
    isAtTopOfScrollback || initiallyVisibleTitleCount <= 0 ? 0 : TITLE_OUTPUT_GAP_ROWS;
  const initialGap = Math.max(0, upperRowCount - initiallyVisibleTitleCount - reservedTitleGap);
  const scrollWindow = dropTrailingByDisplayRows(outputLines, clampedOffset, renderWidth);
  const firstContentIndex = scrollWindow.findIndex((line) => !isVisuallyEmptyLine(line));
  const contentWindow = firstContentIndex === -1 ? [] : scrollWindow.slice(firstContentIndex);
  let lastContentIndex = -1;
  for (let index = contentWindow.length - 1; index >= 0; index -= 1) {
    if (!isVisuallyEmptyLine(contentWindow[index] ?? "")) {
      lastContentIndex = index;
      break;
    }
  }
  const pressureWindow =
    lastContentIndex === -1 ? [] : contentWindow.slice(0, lastContentIndex + 1);
  const trailingSpacerRows =
    lastContentIndex === -1 ? [] : contentWindow.slice(lastContentIndex + 1);
  const outputCount = countDisplayRows(pressureWindow, renderWidth);

  const outputConsumedByGap = isAtTopOfScrollback ? 0 : Math.min(outputCount, initialGap);
  const outputAfterGap = outputCount - outputConsumedByGap;

  const outputConsumedByTitle = isAtTopOfScrollback
    ? 0
    : Math.min(outputAfterGap, initiallyVisibleTitleCount);
  const totalHiddenTitle = baseHiddenTitle + outputConsumedByTitle;
  const visibleTitle = titleLines.slice(totalHiddenTitle);

  const hiddenOutputRows = isAtTopOfScrollback
    ? 0
    : Math.max(0, outputAfterGap - initiallyVisibleTitleCount);
  const visibleCoreOutput = dropLeadingByDisplayRows(pressureWindow, hiddenOutputRows, renderWidth);

  const topModeGapRows = isAtTopOfScrollback && visibleTitle.length > 0 ? TITLE_OUTPUT_GAP_ROWS : 0;
  const outputRowsAvailable = Math.max(0, upperRowCount - visibleTitle.length - topModeGapRows);
  const visibleOutput = [...visibleCoreOutput];
  let usedOutputRows = countDisplayRows(visibleOutput, renderWidth);
  for (const spacerRow of trailingSpacerRows) {
    const nextRows = usedOutputRows + lineDisplayRows(spacerRow, renderWidth);
    if (nextRows > outputRowsAvailable) {
      break;
    }
    visibleOutput.push(spacerRow);
    usedOutputRows = nextRows;
  }

  if (usedOutputRows < outputRowsAvailable) {
    const outputPadding = new Array<string>(outputRowsAvailable - usedOutputRows).fill("");
    if (isAtTopOfScrollback) {
      const titleGapPadding = new Array<string>(topModeGapRows).fill("");
      return {
        titleLines: visibleTitle,
        outputLines: [...titleGapPadding, ...visibleOutput, ...outputPadding],
        promptLines: visiblePrompt
      };
    }
    return {
      titleLines: visibleTitle,
      outputLines: [...outputPadding, ...visibleOutput],
      promptLines: visiblePrompt
    };
  }

  if (usedOutputRows > outputRowsAvailable) {
    const trimmedOutput = dropLeadingByDisplayRows(
      visibleOutput,
      usedOutputRows - outputRowsAvailable,
      renderWidth
    );
    if (isAtTopOfScrollback) {
      const titleGapPadding = new Array<string>(topModeGapRows).fill("");
      return {
        titleLines: visibleTitle,
        outputLines: [...titleGapPadding, ...trimmedOutput],
        promptLines: visiblePrompt
      };
    }
    return {
      titleLines: visibleTitle,
      outputLines: trimmedOutput,
      promptLines: visiblePrompt
    };
  }

  if (isAtTopOfScrollback) {
    const titleGapPadding = new Array<string>(topModeGapRows).fill("");
    return {
      titleLines: visibleTitle,
      outputLines: [...titleGapPadding, ...visibleOutput],
      promptLines: visiblePrompt
    };
  }

  return {
    titleLines: visibleTitle,
    outputLines: visibleOutput,
    promptLines: visiblePrompt
  };
}

export function computeTitleVisibleScrollCap(
  rows: number,
  titleLines: string[],
  outputLines: string[],
  promptLines: string[]
): number {
  const safeRows = Math.max(1, rows);
  const promptCount = Math.min(promptLines.length, safeRows);
  const visiblePrompt = promptLines.slice(-promptCount);
  const renderWidth = inferRenderWidth(titleLines, visiblePrompt);
  return computeUsefulOutputScrollCapRows({
    rows: safeRows,
    titleLines,
    outputLines,
    promptLines: visiblePrompt,
    width: renderWidth
  });
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
  const leftBottom = horizontalGradientAtOffset("╰", GRADIENT_PINK, GRADIENT_YELLOW, 0, width);
  const fillBottom = horizontalGradientAtOffset(fill, GRADIENT_PINK, GRADIENT_YELLOW, 1, width);
  const statusBottom = colorText(clippedStatus, GRADIENT_BLUE);
  const rightBottom = horizontalGradientAtOffset(
    "╯",
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    width - 1,
    width
  );
  lines.push(`${leftBottom}${fillBottom}${statusBottom}${rightBottom}`);
  return lines;
}
