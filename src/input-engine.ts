/** Raw-stdin input parser for deterministic prompt editing actions. */

import { StringDecoder } from "node:string_decoder";

export type InputAction =
  | { type: "insert"; text: string }
  | { type: "submit" }
  | { type: "newline" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "move-left" }
  | { type: "move-right" }
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "cancel" }
  | { type: "tab" };

interface EscapeParseResult {
  action: InputAction | null;
  nextIndex: number;
}

function parseInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function isEnterKeyCode(code: number): boolean {
  return code === 1 || code === 10 || code === 13 || code === 57414;
}

function toEnterAction(modifier: number): InputAction {
  return modifier > 1 ? { type: "newline" } : { type: "submit" };
}

function parseEnterActionFromCsiBody(body: string, final: string): InputAction | null {
  if (final === "u" || final === "~" || final === "M") {
    const keyOnly = body.match(/^(\d+)$/);
    if (keyOnly) {
      const keyCode = parseInteger(keyOnly[1] ?? "");
      if (keyCode !== null && isEnterKeyCode(keyCode)) {
        return { type: "submit" };
      }
    }

    const keyAndModifier = body.match(/^(\d+);(\d+)$/);
    if (keyAndModifier) {
      const keyCode = parseInteger(keyAndModifier[1] ?? "");
      const modifier = parseInteger(keyAndModifier[2] ?? "");
      if (keyCode !== null && modifier !== null && isEnterKeyCode(keyCode) && modifier >= 1) {
        return toEnterAction(modifier);
      }
    }
  }

  if (final === "~") {
    const legacyModifyOtherKeys = body.match(/^27;(\d+);(\d+)$/);
    if (legacyModifyOtherKeys) {
      const first = parseInteger(legacyModifyOtherKeys[1] ?? "");
      const second = parseInteger(legacyModifyOtherKeys[2] ?? "");

      if (first === null || second === null) {
        return null;
      }

      if (isEnterKeyCode(first) && second >= 1) {
        return toEnterAction(second);
      }

      if (isEnterKeyCode(second) && first >= 1) {
        return toEnterAction(first);
      }
    }
  }

  return null;
}

export function parseCsiSequence(sequence: string): InputAction | null {
  if (!sequence.startsWith("\x1b[")) {
    return null;
  }

  if (sequence.length < 3) {
    return null;
  }

  const final = sequence[sequence.length - 1] ?? "";
  const body = sequence.slice(2, -1);

  const enterAction = parseEnterActionFromCsiBody(body, final);
  if (enterAction) {
    return enterAction;
  }

  if (final === "A") return { type: "move-up" };
  if (final === "B") return { type: "move-down" };
  if (final === "C") return { type: "move-right" };
  if (final === "D") return { type: "move-left" };
  if (final === "H") return { type: "home" };
  if (final === "F") return { type: "end" };
  if (final === "Z") return { type: "tab" };

  if (final === "~") {
    const firstParam = body.split(";")[0] ?? "";
    if (firstParam === "1" || firstParam === "7") return { type: "home" };
    if (firstParam === "4" || firstParam === "8") return { type: "end" };
    if (firstParam === "3") return { type: "delete" };
  }

  return null;
}

function isCsiFinalByte(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e;
}

function parseEscapeSequence(buffer: Buffer, startIndex: number): EscapeParseResult | null {
  if (startIndex + 1 >= buffer.length) {
    return null;
  }

  const second = buffer[startIndex + 1] ?? 0;

  if (second === 0x5b) {
    let index = startIndex + 2;
    while (index < buffer.length) {
      const byte = buffer[index] ?? 0;
      if (isCsiFinalByte(byte)) {
        const sequence = buffer.subarray(startIndex, index + 1).toString("latin1");
        return { action: parseCsiSequence(sequence), nextIndex: index + 1 };
      }
      index += 1;
    }

    return null;
  }

  if (second === 0x4f) {
    if (startIndex + 2 >= buffer.length) {
      return null;
    }

    const third = buffer[startIndex + 2] ?? 0;
    if (third === 0x4d) {
      return { action: { type: "submit" }, nextIndex: startIndex + 3 };
    }

    return { action: null, nextIndex: startIndex + 3 };
  }

  if (second === 0x0d || second === 0x0a) {
    return { action: { type: "newline" }, nextIndex: startIndex + 2 };
  }

  return { action: null, nextIndex: startIndex + 2 };
}

export class InputEngine {
  private pending: Buffer = Buffer.alloc(0);
  private readonly decoder = new StringDecoder("utf8");

  reset(): void {
    this.pending = Buffer.alloc(0);
    this.decoder.end();
  }

  pushChunk(chunk: Buffer | string): InputAction[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "latin1");
    if (incoming.length === 0) {
      return [];
    }

    this.pending =
      this.pending.length > 0 ? Buffer.concat([this.pending, incoming]) : Buffer.from(incoming);

    const actions: InputAction[] = [];
    let index = 0;
    let textStart: number | null = null;

    const flushText = (endIndex: number): void => {
      if (textStart === null || endIndex <= textStart) {
        textStart = null;
        return;
      }

      const text = this.decoder.write(this.pending.subarray(textStart, endIndex));
      if (text.length > 0) {
        actions.push({ type: "insert", text });
      }
      textStart = null;
    };

    while (index < this.pending.length) {
      const byte = this.pending[index] ?? 0;

      if (byte === 0x1b) {
        flushText(index);
        const parsed = parseEscapeSequence(this.pending, index);
        if (!parsed) {
          break;
        }
        if (parsed.action) {
          actions.push(parsed.action);
        }
        index = parsed.nextIndex;
        continue;
      }

      if (byte === 0x03) {
        flushText(index);
        actions.push({ type: "cancel" });
        index += 1;
        continue;
      }

      if (byte === 0x7f || byte === 0x08) {
        flushText(index);
        actions.push({ type: "backspace" });
        index += 1;
        continue;
      }

      if (byte === 0x0d) {
        flushText(index);
        actions.push({ type: "submit" });
        index += 1;
        if (this.pending[index] === 0x0a) {
          index += 1;
        }
        continue;
      }

      if (byte === 0x0a) {
        flushText(index);
        actions.push({ type: "newline" });
        index += 1;
        continue;
      }

      if (byte === 0x09) {
        flushText(index);
        actions.push({ type: "tab" });
        index += 1;
        continue;
      }

      if (byte < 0x20) {
        flushText(index);
        index += 1;
        continue;
      }

      if (textStart === null) {
        textStart = index;
      }
      index += 1;
    }

    flushText(index);
    this.pending = this.pending.subarray(index);
    return actions;
  }
}
