/** Conversation message formatting with ANSI truecolor styling. */

import {
  colorText,
  DARK_BLUE,
  DIM_GRAY,
  ERROR_RED,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  INPUT_PINK,
  SUCCESS_GREEN,
  WARNING_YELLOW
} from "./colors";

function formatTimestamp(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${period}`;
}

export function formatUserMessage(text: string): string {
  const lines = text.split("\n");
  const first = colorText(`>>> ${lines[0] ?? ""}`, INPUT_PINK);

  if (lines.length <= 1) {
    return first;
  }

  const rest = lines.slice(1).map((line) => colorText(line, INPUT_PINK));
  return [first, ...rest].join("\n");
}

export function formatAssistantMessage(text: string, timestamp?: Date): string {
  const time = timestamp ?? new Date();
  const timestampPlain = `[${formatTimestamp(time)}]`;
  const namePlain = "Yips";
  const prefixPlain = `${timestampPlain} ${namePlain}: `;
  const timeStr = colorText(timestampPlain, DARK_BLUE);
  const name = horizontalGradient(namePlain, GRADIENT_PINK, GRADIENT_YELLOW);
  const colon = colorText(":", DARK_BLUE);

  const lines = text.split("\n");
  const firstLine = lines[0] ?? "";
  const firstBody = horizontalGradient(firstLine, GRADIENT_PINK, GRADIENT_YELLOW);
  const first = `${timeStr} ${name}${colon} ${firstBody}`;

  if (lines.length <= 1) {
    return first;
  }

  const indent = " ".repeat(prefixPlain.length);
  const rest = lines
    .slice(1)
    .map((line) => `${indent}${horizontalGradient(line, GRADIENT_PINK, GRADIENT_YELLOW)}`);

  return [first, ...rest].join("\n");
}

export function formatErrorMessage(text: string): string {
  return colorText(text, ERROR_RED);
}

export function formatWarningMessage(text: string): string {
  return colorText(text, WARNING_YELLOW);
}

export function formatSuccessMessage(text: string): string {
  return colorText(text, SUCCESS_GREEN);
}

export function formatDimMessage(text: string): string {
  return colorText(text, DIM_GRAY);
}
