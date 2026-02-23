/** Conversation message formatting with terminal-kit color markup. */

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
  return colorText(`>>> ${text}`, INPUT_PINK);
}

export function formatAssistantMessage(text: string, timestamp?: Date): string {
  const time = timestamp ?? new Date();
  const timeStr = colorText(`[${formatTimestamp(time)}]`, DARK_BLUE);
  const label = horizontalGradient("Yips:", GRADIENT_PINK, GRADIENT_YELLOW);
  const body = horizontalGradient(text, GRADIENT_PINK, GRADIENT_YELLOW);
  return `${timeStr} ${label} ${body}`;
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
