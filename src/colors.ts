/** Color palette and gradient utilities for terminal-kit markup. */

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

// --- Terminal-kit markup helpers ---

/** Wrap a single character with terminal-kit truecolor markup. */
export function colorChar(char: string, color: Rgb): string {
  return `^#${toHex(color).slice(1)}${char}`;
}

/** Apply a solid color to an entire string using terminal-kit markup. */
export function colorText(text: string, color: Rgb): string {
  if (text.length === 0) return "";
  return `^#${toHex(color).slice(1)}${text}^:`;
}

/**
 * Apply a horizontal gradient across a string.
 * Each visible character gets its own color interpolated between start and end.
 */
export function horizontalGradient(text: string, startColor: Rgb, endColor: Rgb): string {
  if (text.length === 0) return "";
  if (text.length === 1) return colorChar(text, startColor) + "^:";

  const chars: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const t = i / (text.length - 1);
    const color = interpolateColor(startColor, endColor, t);
    chars.push(colorChar(text[i]!, color));
  }
  chars.push("^:");
  return chars.join("");
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

  const maxLen = Math.max(...lines.map((l) => l.length));
  if (maxLen === 0) return lines.map(() => "");

  const totalSteps = lines.length - 1 + maxLen - 1;

  return lines.map((line, row) => {
    if (line.length === 0) return "";
    const chars: string[] = [];
    for (let col = 0; col < line.length; col++) {
      const t = totalSteps > 0 ? (row + col) / totalSteps : 0;
      const color = interpolateColor(startColor, endColor, t);
      chars.push(colorChar(line[col]!, color));
    }
    chars.push("^:");
    return chars.join("");
  });
}
