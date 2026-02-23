/** Bounded multiline prompt composer state machine. */

export interface PromptComposerLayout {
  text: string;
  cursor: number;
  rows: string[];
  rowStarts: number[];
  rowEnds: number[];
  rowCount: number;
  cursorRow: number;
  cursorCol: number;
  interiorWidth: number;
  prefix: string;
  firstRowContentWidth: number;
}

export interface PromptComposerKeyData {
  isCharacter?: boolean;
}

export interface PromptComposerOptions {
  interiorWidth: number;
  history: readonly string[];
  autoComplete: readonly string[];
  prefix?: string;
  text?: string;
  cursor?: number;
}

export type PromptComposerEvent =
  | { type: "none" }
  | { type: "submit"; value: string }
  | { type: "cancel" }
  | { type: "autocomplete-menu"; options: string[]; tokenStart: number; tokenEnd: number };

const DEFAULT_PREFIX = ">>> ";

function toChars(text: string): string[] {
  return Array.from(text);
}

function charLength(text: string): number {
  return Array.from(text).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function takeLeftChars(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const chars = toChars(text);
  return chars.slice(0, maxWidth).join("");
}

function commonPrefix(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";

  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    const left = toChars(prefix);
    const right = toChars(value);
    const length = Math.min(left.length, right.length);
    let i = 0;
    while (i < length && left[i] === right[i]) i += 1;
    prefix = left.slice(0, i).join("");
    if (prefix.length === 0) break;
  }
  return prefix;
}

function rowCapacity(
  rowIndex: number,
  firstRowContentWidth: number,
  interiorWidth: number
): number {
  return rowIndex === 0 ? firstRowContentWidth : interiorWidth;
}

export function buildPromptComposerLayout(
  text: string,
  cursor: number,
  interiorWidth: number,
  prefix: string = DEFAULT_PREFIX
): PromptComposerLayout {
  const safeInteriorWidth = Math.max(0, interiorWidth);
  const visiblePrefix = takeLeftChars(prefix, safeInteriorWidth);
  const firstRowContentWidth = Math.max(0, safeInteriorWidth - charLength(visiblePrefix));

  const textChars = toChars(text);
  const safeCursor = clamp(cursor, 0, textChars.length);

  const rowChars: string[][] = [[]];
  const rowStarts: number[] = [0];
  const rowEnds: number[] = [];

  if (safeInteriorWidth > 0) {
    let rowIndex = 0;

    for (let textIndex = 0; textIndex < textChars.length; textIndex++) {
      const char = textChars[textIndex] ?? "";

      if (char === "\n") {
        rowEnds[rowIndex] = textIndex;
        rowIndex += 1;
        rowChars[rowIndex] = [];
        rowStarts[rowIndex] = textIndex + 1;
        continue;
      }

      let placed = false;

      while (!placed) {
        const capacity = rowCapacity(rowIndex, firstRowContentWidth, safeInteriorWidth);

        if (capacity <= 0) {
          rowEnds[rowIndex] = textIndex;
          rowIndex += 1;
          rowChars[rowIndex] = rowChars[rowIndex] ?? [];
          rowStarts[rowIndex] = rowStarts[rowIndex] ?? textIndex;
          continue;
        }

        if ((rowChars[rowIndex]?.length ?? 0) < capacity) {
          rowChars[rowIndex]?.push(char);
          placed = true;
          continue;
        }

        rowEnds[rowIndex] = textIndex;
        rowIndex += 1;
        rowChars[rowIndex] = rowChars[rowIndex] ?? [];
        rowStarts[rowIndex] = rowStarts[rowIndex] ?? textIndex;
      }
    }

    rowEnds[rowIndex] = textChars.length;
  } else {
    for (let textIndex = 0; textIndex < textChars.length; textIndex++) {
      if (textChars[textIndex] !== "\n") continue;
      rowEnds[rowStarts.length - 1] = textIndex;
      rowStarts.push(textIndex + 1);
      rowChars.push([]);
    }
    rowEnds[rowStarts.length - 1] = textChars.length;
  }

  const rows = rowChars.map((chars) => chars.join(""));
  if (rows.length === 0) rows.push("");

  let cursorRow = rows.length - 1;
  let cursorCol = charLength(rows[cursorRow] ?? "");

  for (let i = 0; i < rows.length; i++) {
    const rowStart = rowStarts[i] ?? 0;
    const rowEnd = rowEnds[i] ?? 0;
    if (safeCursor >= rowStart && safeCursor <= rowEnd) {
      cursorRow = i;
      cursorCol = safeCursor - rowStart;
      break;
    }
  }

  return {
    text,
    cursor: safeCursor,
    rows,
    rowStarts,
    rowEnds,
    rowCount: rows.length,
    cursorRow,
    cursorCol,
    interiorWidth: safeInteriorWidth,
    prefix: visiblePrefix,
    firstRowContentWidth
  };
}

function textFromChars(chars: readonly string[]): string {
  return chars.join("");
}

function whitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function noneEvent(): PromptComposerEvent {
  return { type: "none" };
}

export class PromptComposer {
  private chars: string[];
  private cursor: number;
  private readonly prefix: string;
  private interiorWidth: number;
  private readonly history: readonly string[];
  private readonly autoComplete: readonly string[];
  private historyIndex: number;
  private historyDraft: string;
  private preferredColumn: number | null;
  private layout: PromptComposerLayout;

  constructor(options: PromptComposerOptions) {
    const initialText = options.text ?? "";
    this.chars = toChars(initialText);
    this.cursor = clamp(options.cursor ?? this.chars.length, 0, this.chars.length);
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.interiorWidth = Math.max(0, options.interiorWidth);
    this.history = options.history;
    this.autoComplete = options.autoComplete;
    this.historyIndex = this.history.length;
    this.historyDraft = initialText;
    this.preferredColumn = null;
    this.layout = buildPromptComposerLayout(
      textFromChars(this.chars),
      this.cursor,
      this.interiorWidth,
      this.prefix
    );
  }

  getText(): string {
    return textFromChars(this.chars);
  }

  getCursor(): number {
    return this.cursor;
  }

  getLayout(): PromptComposerLayout {
    return this.layout;
  }

  setInteriorWidth(width: number): void {
    this.interiorWidth = Math.max(0, width);
    this.recomputeLayout();
  }

  applyAutocompleteChoice(tokenStart: number, tokenEnd: number, selection: string): void {
    this.replaceRange(tokenStart, tokenEnd, selection);
  }

  handleKey(key: string, data?: PromptComposerKeyData): PromptComposerEvent {
    if (data?.isCharacter) {
      this.detachFromHistory();
      this.preferredColumn = null;
      this.insertText(key);
      return noneEvent();
    }

    switch (key) {
      case "ENTER":
      case "KP_ENTER":
      case "CTRL_M":
        return { type: "submit", value: this.getText() };
      case "CTRL_ENTER":
        this.detachFromHistory();
        this.preferredColumn = null;
        this.insertText("\n");
        return noneEvent();
      case "ESCAPE":
        return { type: "cancel" };
      case "BACKSPACE":
        this.detachFromHistory();
        this.preferredColumn = null;
        this.backspace();
        return noneEvent();
      case "DELETE":
        this.detachFromHistory();
        this.preferredColumn = null;
        this.deleteForward();
        return noneEvent();
      case "LEFT":
        this.preferredColumn = null;
        this.moveCursor(-1);
        return noneEvent();
      case "RIGHT":
        this.preferredColumn = null;
        this.moveCursor(1);
        return noneEvent();
      case "HOME":
        this.preferredColumn = null;
        this.moveToLineBoundary("start");
        return noneEvent();
      case "END":
        this.preferredColumn = null;
        this.moveToLineBoundary("end");
        return noneEvent();
      case "UP":
        if (this.moveVertical(-1)) return noneEvent();
        this.historyPrevious();
        return noneEvent();
      case "DOWN":
        if (this.moveVertical(1)) return noneEvent();
        this.historyNext();
        return noneEvent();
      case "TAB":
        return this.handleAutoComplete();
      default:
        return noneEvent();
    }
  }

  private recomputeLayout(): void {
    this.layout = buildPromptComposerLayout(
      textFromChars(this.chars),
      this.cursor,
      this.interiorWidth,
      this.prefix
    );
  }

  private detachFromHistory(): void {
    if (this.historyIndex === this.history.length) return;
    this.historyIndex = this.history.length;
    this.historyDraft = this.getText();
  }

  private insertText(text: string): void {
    const insert = toChars(text);
    if (insert.length === 0) return;
    this.chars.splice(this.cursor, 0, ...insert);
    this.cursor += insert.length;
    this.recomputeLayout();
  }

  private replaceRange(start: number, end: number, replacement: string): void {
    const safeStart = clamp(start, 0, this.chars.length);
    const safeEnd = clamp(end, safeStart, this.chars.length);
    const replacementChars = toChars(replacement);

    this.detachFromHistory();
    this.preferredColumn = null;
    this.chars.splice(safeStart, safeEnd - safeStart, ...replacementChars);
    this.cursor = safeStart + replacementChars.length;
    this.recomputeLayout();
  }

  private backspace(): void {
    if (this.cursor <= 0) return;
    this.chars.splice(this.cursor - 1, 1);
    this.cursor -= 1;
    this.recomputeLayout();
  }

  private deleteForward(): void {
    if (this.cursor >= this.chars.length) return;
    this.chars.splice(this.cursor, 1);
    this.recomputeLayout();
  }

  private moveCursor(delta: number): void {
    this.cursor = clamp(this.cursor + delta, 0, this.chars.length);
    this.recomputeLayout();
  }

  private moveToLineBoundary(target: "start" | "end"): void {
    const row = this.layout.cursorRow;
    if (target === "start") {
      this.cursor = this.layout.rowStarts[row] ?? this.cursor;
    } else {
      this.cursor = this.layout.rowEnds[row] ?? this.cursor;
    }
    this.recomputeLayout();
  }

  private moveVertical(direction: -1 | 1): boolean {
    const targetRow = this.layout.cursorRow + direction;
    if (targetRow < 0 || targetRow >= this.layout.rowCount) {
      return false;
    }

    const preferred = this.preferredColumn ?? this.layout.cursorCol;
    const targetRowLen = charLength(this.layout.rows[targetRow] ?? "");
    const targetCol = Math.min(preferred, targetRowLen);
    const targetStart = this.layout.rowStarts[targetRow] ?? 0;

    this.cursor = targetStart + targetCol;
    this.preferredColumn = preferred;
    this.recomputeLayout();
    return true;
  }

  private historyPrevious(): void {
    if (this.history.length === 0 || this.historyIndex <= 0) return;
    if (this.historyIndex === this.history.length) {
      this.historyDraft = this.getText();
    }

    this.historyIndex -= 1;
    this.loadHistoryValue(this.history[this.historyIndex] ?? "");
  }

  private historyNext(): void {
    if (this.history.length === 0 || this.historyIndex >= this.history.length) return;
    this.historyIndex += 1;

    if (this.historyIndex === this.history.length) {
      this.loadHistoryValue(this.historyDraft);
      return;
    }

    this.loadHistoryValue(this.history[this.historyIndex] ?? "");
  }

  private loadHistoryValue(value: string): void {
    this.chars = toChars(value);
    this.cursor = this.chars.length;
    this.preferredColumn = null;
    this.recomputeLayout();
  }

  private tokenBounds(): {
    start: number;
    end: number;
    token: string;
  } | null {
    if (this.chars.length === 0) return null;

    let start = this.cursor;
    while (start > 0 && !whitespace(this.chars[start - 1])) {
      start -= 1;
    }

    let end = this.cursor;
    while (end < this.chars.length && !whitespace(this.chars[end])) {
      end += 1;
    }

    const token = this.chars.slice(start, end).join("");
    if (token.length === 0) return null;

    return { start, end, token };
  }

  private handleAutoComplete(): PromptComposerEvent {
    const bounds = this.tokenBounds();
    if (!bounds || !bounds.token.startsWith("/")) {
      return noneEvent();
    }

    const options = this.autoComplete.filter((candidate) => candidate.startsWith(bounds.token));
    if (options.length === 0) return noneEvent();

    if (options.length === 1) {
      this.replaceRange(bounds.start, bounds.end, options[0] ?? bounds.token);
      return noneEvent();
    }

    const shared = commonPrefix(options);
    if (shared.length > bounds.token.length) {
      this.replaceRange(bounds.start, bounds.end, shared);
      return noneEvent();
    }

    return {
      type: "autocomplete-menu",
      options: [...options],
      tokenStart: bounds.start,
      tokenEnd: bounds.end
    };
  }
}
