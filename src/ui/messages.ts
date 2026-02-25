/** Conversation message formatting with ANSI truecolor styling. */

import {
  colorText,
  DIM_GRAY,
  ERROR_RED,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  INPUT_PINK,
  SUCCESS_GREEN,
  WARNING_YELLOW
} from "#ui/colors";
import type { SkillExecutionStatus, SubagentExecutionStatus, ToolExecutionStatus } from "#types/app-types";

export type ActionBoxType = "tool" | "skill" | "subagent";
type ActionBoxStatus = ToolExecutionStatus | SkillExecutionStatus | SubagentExecutionStatus;

export interface ActionCallBoxEvent {
  type: ActionBoxType;
  id: string;
  name: string;
  preview?: string;
}

export interface ActionResultBoxEvent {
  type: ActionBoxType;
  id: string;
  name: string;
  status: ActionBoxStatus;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionResultBoxOptions {
  verbose?: boolean;
  previewMaxChars?: number;
}

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
  const timeStr = colorText(timestampPlain, GRADIENT_BLUE);
  const name = horizontalGradient(namePlain, GRADIENT_PINK, GRADIENT_YELLOW);
  const colon = colorText(":", GRADIENT_BLUE);

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

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return chars.slice(0, maxChars).join("");
  }
  return `${chars.slice(0, maxChars - 3).join("")}...`;
}

function normalizePreview(text: string, maxChars: number): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "(no output)";
  }
  return truncate(firstLine, maxChars);
}

function toTypeLabel(type: ActionBoxType): string {
  if (type === "tool") {
    return "Tool";
  }
  if (type === "skill") {
    return "Skill";
  }
  return "Subagent";
}

function boxWidth(lines: readonly string[]): number {
  const maxLen = lines.reduce((acc, line) => Math.max(acc, Array.from(line).length), 0);
  return Math.max(36, Math.min(120, maxLen + 4));
}

function renderBox(title: string, bodyLines: readonly string[]): string {
  const width = boxWidth([title, ...bodyLines]);
  const innerWidth = Math.max(1, width - 2);
  const clippedBody = bodyLines.map((line) => truncate(line, innerWidth));
  const topPadding = "─".repeat(Math.max(0, innerWidth - title.length - 2));
  const top = horizontalGradient(`╭ ${title} ${topPadding}╮`, GRADIENT_PINK, GRADIENT_YELLOW);
  const bottom = horizontalGradient(`╰${"─".repeat(innerWidth)}╯`, GRADIENT_PINK, GRADIENT_YELLOW);

  const rows = clippedBody.map((line) => {
    const pad = " ".repeat(Math.max(0, innerWidth - Array.from(line).length));
    return `${colorText("│", GRADIENT_PINK)}${line}${pad}${colorText("│", GRADIENT_YELLOW)}`;
  });

  return [top, ...rows, bottom].join("\n");
}

export function formatActionCallBox(event: ActionCallBoxEvent): string {
  const title = `${toTypeLabel(event.type)} Call`;
  const bodyLines = [
    `id: ${event.id}`,
    `name: ${event.name}`,
    `preview: ${event.preview && event.preview.trim().length > 0 ? truncate(event.preview.trim(), 96) : "(pending)"}`
  ];
  return renderBox(title, bodyLines);
}

export function formatActionResultBox(
  event: ActionResultBoxEvent,
  options: ActionResultBoxOptions = {}
): string {
  const verbose = options.verbose === true;
  const previewMaxChars = options.previewMaxChars ?? 96;
  const bodyLines: string[] = [
    `id: ${event.id}`,
    `name: ${event.name}`,
    `status: ${event.status}`
  ];

  if (verbose) {
    const outputLines = (event.output ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 4)
      .map((line) => `out: ${truncate(line, previewMaxChars)}`);
    if (outputLines.length === 0) {
      bodyLines.push("out: (no output)");
    } else {
      bodyLines.push(...outputLines);
    }
    if (event.metadata) {
      bodyLines.push(`meta: ${truncate(JSON.stringify(event.metadata), previewMaxChars)}`);
    }
  } else {
    bodyLines.push(`preview: ${normalizePreview(event.output ?? "", previewMaxChars)}`);
  }

  return renderBox(`${toTypeLabel(event.type)} Result`, bodyLines);
}
