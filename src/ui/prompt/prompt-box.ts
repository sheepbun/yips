/** Prompt box layout helpers for the bottom input area. */

export interface PromptBoxFrame {
  top: string;
  middleRows: string[];
  bottom: string;
  innerWidth: number;
}

export interface PromptBoxLayout {
  top: string;
  middle: string;
  bottom: string;
  innerWidth: number;
  prompt: string;
  promptPadding: string;
}

const DEFAULT_PROMPT = ">>> ";

function toChars(text: string): string[] {
  return Array.from(text);
}

function charLength(text: string): number {
  return toChars(text).length;
}

function takeLeftChars(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const chars = toChars(text);
  if (chars.length <= maxWidth) return text;
  return chars.slice(0, maxWidth).join("");
}

function takeRightChars(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const chars = toChars(text);
  if (chars.length <= maxWidth) return text;
  return chars.slice(chars.length - maxWidth).join("");
}

function buildBorderLine(width: number, left: string, right: string, fill: string): string {
  if (width <= 0) return "";
  if (width === 1) return left;
  return `${left}${fill.repeat(Math.max(0, width - 2))}${right}`;
}

function buildContentLine(width: number, left: string, right: string, inner: string): string {
  if (width <= 0) return "";
  if (width === 1) return left;
  return `${left}${inner}${right}`;
}

function normalizeStatusText(statusText: string): string {
  const trimmed = statusText.trim();
  return trimmed.length > 0 ? ` ${trimmed} ` : " ";
}

export function buildPromptBoxFrame(
  width: number,
  statusText: string,
  middleRowCount: number
): PromptBoxFrame {
  const safeWidth = Math.max(0, width);
  const innerWidth = Math.max(0, safeWidth - 2);
  const rowCount = Math.max(1, middleRowCount);
  const middleInner = " ".repeat(innerWidth);

  const normalizedStatus = normalizeStatusText(statusText);
  // Keep the right edge on narrow terminals so model suffixes remain visible.
  const clippedStatus = takeRightChars(normalizedStatus, innerWidth);
  const clippedStatusWidth = charLength(clippedStatus);
  const fill = "─".repeat(Math.max(0, innerWidth - clippedStatusWidth));
  const bottomInner = `${fill}${clippedStatus}`;

  return {
    top: buildBorderLine(safeWidth, "╭", "╮", "─"),
    middleRows: Array.from({ length: rowCount }, () =>
      buildContentLine(safeWidth, "│", "│", middleInner)
    ),
    bottom: buildContentLine(safeWidth, "╰", "╯", bottomInner),
    innerWidth
  };
}

export function buildPromptBoxLayout(
  width: number,
  statusText: string,
  promptText: string = DEFAULT_PROMPT
): PromptBoxLayout {
  const frame = buildPromptBoxFrame(width, statusText, 1);

  const prompt = takeLeftChars(promptText, frame.innerWidth);
  const promptPadding = " ".repeat(Math.max(0, frame.innerWidth - charLength(prompt)));
  const middleInner = `${prompt}${promptPadding}`;

  return {
    top: frame.top,
    middle: buildContentLine(Math.max(0, width), "│", "│", middleInner),
    bottom: frame.bottom,
    innerWidth: frame.innerWidth,
    prompt,
    promptPadding
  };
}
