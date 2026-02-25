/** Color palette and gradient utilities for ANSI truecolor output. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// --- Palette constants ---

export const GRADIENT_PINK: Rgb = { r: 0xff, g: 0x14, b: 0x93 };
export const GRADIENT_YELLOW: Rgb = { r: 0xff, g: 0xe1, b: 0x35 };
export const GRADIENT_BLUE: Rgb = { r: 0x89, g: 0xcf, b: 0xf0 };
export const DARK_BLUE: Rgb = { r: 0x00, g: 0x66, b: 0xcc };
export const INPUT_PINK: Rgb = { r: 0xff, g: 0xcc, b: 0xff };
export const VT_GREEN: Rgb = { r: 0x00, g: 0xff, b: 0x00 };
export const ERROR_RED: Rgb = { r: 0xff, g: 0x44, b: 0x44 };
export const WARNING_YELLOW: Rgb = { r: 0xff, g: 0xcc, b: 0x00 };
export const SUCCESS_GREEN: Rgb = { r: 0x44, g: 0xff, b: 0x44 };
export const DIM_GRAY: Rgb = { r: 0x88, g: 0x88, b: 0x88 };

const ANSI_RESET_FOREGROUND = "\u001b[39m";
const ANSI_RESET_ALL = "\u001b[0m";

// --- Color utilities ---

export function parseHex(hex: string): Rgb {
  const cleaned = hex.replace(/^#/, "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  };
}

export function toHex(color: Rgb): string {
  const r = Math.round(Math.max(0, Math.min(255, color.r)));
  const g = Math.round(Math.max(0, Math.min(255, color.g)));
  const b = Math.round(Math.max(0, Math.min(255, color.b)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function interpolateColor(start: Rgb, end: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: start.r + (end.r - start.r) * clamped,
    g: start.g + (end.g - start.g) * clamped,
    b: start.b + (end.b - start.b) * clamped
  };
}

function toAnsiColor(color: Rgb): string {
  const r = Math.round(Math.max(0, Math.min(255, color.r)));
  const g = Math.round(Math.max(0, Math.min(255, color.g)));
  const b = Math.round(Math.max(0, Math.min(255, color.b)));
  return `\u001b[38;2;${r};${g};${b}m`;
}

function toAnsiBackground(color: Rgb): string {
  const r = Math.round(Math.max(0, Math.min(255, color.r)));
  const g = Math.round(Math.max(0, Math.min(255, color.g)));
  const b = Math.round(Math.max(0, Math.min(255, color.b)));
  return `\u001b[48;2;${r};${g};${b}m`;
}

export function stripAnsi(text: string): string {
  let output = "";

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\u001b" && text[i + 1] === "[") {
      i += 2;
      while (i < text.length && text[i] !== "m") {
        i += 1;
      }
      continue;
    }

    output += text[i] ?? "";
  }

  return output;
}

/** Wrap a single character with ANSI truecolor sequence. */
export function colorChar(char: string, color: Rgb): string {
  return `${toAnsiColor(color)}${char}`;
}

/** Apply a solid color to an entire string using ANSI truecolor. */
export function colorText(text: string, color: Rgb): string {
  if (text.length === 0) return "";
  return `${toAnsiColor(color)}${text}${ANSI_RESET_FOREGROUND}`;
}

/** Apply background (+ optional foreground) color to a string. */
export function bgColorText(text: string, bgColor: Rgb, fgColor?: Rgb): string {
  if (text.length === 0) return "";
  const fg = fgColor ? toAnsiColor(fgColor) : "";
  return `${toAnsiBackground(bgColor)}${fg}${text}${ANSI_RESET_ALL}`;
}

/**
 * Apply a horizontal gradient across a string.
 * Each visible character gets its own color interpolated between start and end.
 */
export function horizontalGradient(text: string, startColor: Rgb, endColor: Rgb): string {
  const chars = Array.from(text);
  if (chars.length === 0) return "";
  if (chars.length === 1) {
    return `${colorChar(chars[0] ?? "", startColor)}${ANSI_RESET_FOREGROUND}`;
  }

  const gradientChars: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = i / (chars.length - 1);
    const color = interpolateColor(startColor, endColor, t);
    gradientChars.push(colorChar(chars[i] ?? "", color));
  }

  gradientChars.push(ANSI_RESET_FOREGROUND);
  return gradientChars.join("");
}

/**
 * Apply a horizontal gradient to a string using an absolute offset in a larger line.
 * Useful when rendering segmented strings that should share one continuous gradient.
 */
export function horizontalGradientAtOffset(
  text: string,
  startColor: Rgb,
  endColor: Rgb,
  offset: number,
  totalWidth: number
): string {
  const chars = Array.from(text);
  if (chars.length === 0) return "";

  const safeTotalWidth = Math.max(1, totalWidth);
  const denominator = Math.max(1, safeTotalWidth - 1);
  const baseOffset = Math.max(0, offset);

  const gradientChars: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = Math.max(0, Math.min(1, (baseOffset + i) / denominator));
    const color = interpolateColor(startColor, endColor, t);
    gradientChars.push(colorChar(chars[i] ?? "", color));
  }

  gradientChars.push(ANSI_RESET_FOREGROUND);
  return gradientChars.join("");
}

/** Apply a left-to-right background gradient across a string. */
export function horizontalGradientBackground(
  text: string,
  startColor: Rgb,
  endColor: Rgb,
  fgColor?: Rgb
): string {
  const chars = Array.from(text);
  if (chars.length === 0) return "";
  const fg = fgColor ? toAnsiColor(fgColor) : "";
  if (chars.length === 1) {
    return `${toAnsiBackground(startColor)}${fg}${chars[0] ?? ""}${ANSI_RESET_ALL}`;
  }

  const gradientChars: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const t = i / (chars.length - 1);
    const color = interpolateColor(startColor, endColor, t);
    gradientChars.push(`${toAnsiBackground(color)}${fg}${chars[i] ?? ""}`);
  }

  gradientChars.push(ANSI_RESET_ALL);
  return gradientChars.join("");
}

/**
 * Apply a diagonal gradient across multiple lines.
 * Each character's color is based on (row + col) / (totalRows + totalCols).
 */
export function diagonalGradient(
  lines: readonly string[],
  startColor: Rgb,
  endColor: Rgb
): string[] {
  if (lines.length === 0) return [];

  const splitLines = lines.map((line) => Array.from(line));
  const maxLen = Math.max(...splitLines.map((lineChars) => lineChars.length));
  if (maxLen === 0) return lines.map(() => "");

  const totalSteps = lines.length - 1 + maxLen - 1;

  return splitLines.map((lineChars, row) => {
    if (lineChars.length === 0) return "";

    const gradientChars: string[] = [];
    for (let col = 0; col < lineChars.length; col++) {
      const t = totalSteps > 0 ? (row + col) / totalSteps : 0;
      const color = interpolateColor(startColor, endColor, t);
      gradientChars.push(colorChar(lineChars[col] ?? "", color));
    }

    gradientChars.push(ANSI_RESET_FOREGROUND);
    return gradientChars.join("");
  });
}

/**
 * Apply a multiline gradient by scanning cells row-by-row.
 * Progress advances left-to-right per row, then continues on the next row.
 */
export function rowMajorGradient(
  lines: readonly string[],
  startColor: Rgb,
  endColor: Rgb
): string[] {
  if (lines.length === 0) return [];

  const splitLines = lines.map((line) => Array.from(line));
  const maxLen = Math.max(...splitLines.map((lineChars) => lineChars.length));
  if (maxLen === 0) return lines.map(() => "");

  const totalCells = lines.length * maxLen;

  return splitLines.map((lineChars, row) => {
    if (lineChars.length === 0) return "";

    const gradientChars: string[] = [];
    for (let col = 0; col < lineChars.length; col++) {
      const cellIndex = row * maxLen + col;
      const t = totalCells > 1 ? cellIndex / (totalCells - 1) : 0;
      const color = interpolateColor(startColor, endColor, t);
      gradientChars.push(colorChar(lineChars[col] ?? "", color));
    }

    gradientChars.push(ANSI_RESET_FOREGROUND);
    return gradientChars.join("");
  });
}
