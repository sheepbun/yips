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
import type {
  SkillExecutionStatus,
  SubagentExecutionStatus,
  ToolExecutionStatus
} from "#types/app-types";

export type ActionBoxType = "tool" | "skill" | "subagent";
type ActionBoxStatus = ToolExecutionStatus | SkillExecutionStatus | SubagentExecutionStatus;

export interface ActionCallBoxEvent {
  type: ActionBoxType;
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
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
  showIds?: boolean;
}

export interface ActionCallBoxOptions {
  verbose?: boolean;
  showIds?: boolean;
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

function normalizeStringArg(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compact(value: string | null, fallback: string, maxChars = 72): string {
  return truncate((value ?? fallback).replace(/\s+/gu, " "), maxChars);
}

function blue(text: string): string {
  return colorText(text, GRADIENT_BLUE);
}

function formatToolCallLabel(name: string, args: Record<string, unknown>): string {
  if (name === "run_command") {
    return `Bash(${compact(normalizeStringArg(args.command), "<command>")})`;
  }
  if (name === "read_file") {
    return `Read(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "preview_write_file") {
    return `PreviewWrite(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "preview_edit_file") {
    return `PreviewEdit(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "apply_file_change") {
    return `ApplyChange(${compact(normalizeStringArg(args.token), "<token>", 32)})`;
  }
  if (name === "list_dir") {
    return `List(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "grep") {
    const pattern = compact(normalizeStringArg(args.pattern), "<pattern>", 48);
    const path = compact(normalizeStringArg(args.path), ".", 48);
    return `Search("${pattern}" in ${path})`;
  }
  if (name === "write_file") {
    return `Write(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "edit_file") {
    return `Edit(${compact(normalizeStringArg(args.path), ".")})`;
  }
  return `Tool(${name})`;
}

function formatSkillCallLabel(name: string, args: Record<string, unknown>): string {
  if (name === "search") {
    const query = normalizeStringArg(args.query) ?? normalizeStringArg(args.q);
    return `Search(${compact(query, "<query>")})`;
  }
  if (name === "fetch") {
    return `Fetch(${compact(normalizeStringArg(args.url), "<url>")})`;
  }
  if (name === "build") {
    return `Build(${compact(normalizeStringArg(args.command), "auto")})`;
  }
  if (name === "todos") {
    return `Todos(${compact(normalizeStringArg(args.path), ".")})`;
  }
  if (name === "virtual_terminal") {
    return `VirtualTerminal(${compact(normalizeStringArg(args.command), "<command>")})`;
  }
  return `Skill(${name})`;
}

function formatCallLabel(event: ActionCallBoxEvent): string {
  const args = event.arguments ?? {};
  if (event.type === "tool") {
    return formatToolCallLabel(event.name, args);
  }
  if (event.type === "skill") {
    return formatSkillCallLabel(event.name, args);
  }
  return `Subagent(${compact(event.name, toTypeLabel(event.type))})`;
}

function formatActionCallLine(event: ActionCallBoxEvent): string {
  const bullet = `${blue("●")} `;
  const args = event.arguments ?? {};

  if (event.type === "tool") {
    if (event.name === "read_file") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("Read(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "preview_write_file") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("PreviewWrite(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "preview_edit_file") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("PreviewEdit(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "apply_file_change") {
      const token = compact(normalizeStringArg(args.token), "<token>", 32);
      return `${bullet}${horizontalGradient("ApplyChange(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(token)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "list_dir") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("List(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "write_file") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("Write(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "edit_file") {
      const path = compact(normalizeStringArg(args.path), ".");
      return `${bullet}${horizontalGradient("Edit(", GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
    if (event.name === "grep") {
      const pattern = compact(normalizeStringArg(args.pattern), "<pattern>", 48);
      const path = compact(normalizeStringArg(args.path), ".", 48);
      return `${bullet}${horizontalGradient(`Search("${pattern}" in `, GRADIENT_PINK, GRADIENT_YELLOW)}${blue(path)}${horizontalGradient(")", GRADIENT_PINK, GRADIENT_YELLOW)}`;
    }
  }

  return `${bullet}${horizontalGradient(formatCallLabel(event), GRADIENT_PINK, GRADIENT_YELLOW)}`;
}

function resultSummaryForStatus(status: ActionBoxStatus, summary: string): string {
  if (status === "ok") {
    return summary;
  }
  return `${status}: ${summary}`;
}

function statusColor(status: ActionBoxStatus) {
  if (status === "error") {
    return ERROR_RED;
  }
  if (status === "timeout" || status === "denied") {
    return WARNING_YELLOW;
  }
  return DIM_GRAY;
}

function toOutputLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatActionCallBox(
  event: ActionCallBoxEvent,
  options: ActionCallBoxOptions = {}
): string {
  const showIds = options.showIds ?? options.verbose === true;
  const line = formatActionCallLine(event);
  const detailLines: string[] = [];
  if (showIds) {
    detailLines.push(colorText(`⎿ id: ${event.id}`, DIM_GRAY));
  }
  if (options.verbose === true && event.preview && event.preview.trim().length > 0) {
    detailLines.push(colorText(`⎿ ${truncate(event.preview.trim(), 96)}`, DIM_GRAY));
  }
  return [line, ...detailLines].join("\n");
}

export function formatActionResultBox(
  event: ActionResultBoxEvent,
  options: ActionResultBoxOptions = {}
): string {
  const verbose = options.verbose === true;
  const showIds = options.showIds ?? verbose;
  const previewMaxChars = options.previewMaxChars ?? 96;
  const summary = resultSummaryForStatus(
    event.status,
    normalizePreview(event.output ?? "", previewMaxChars)
  );
  const lines: string[] = [colorText(`⎿ ${summary}`, statusColor(event.status))];

  if (!verbose) {
    return lines.join("\n");
  }

  if (showIds) {
    lines.push(colorText(`⎿ id: ${event.id}`, DIM_GRAY));
  }

  const outputLines = toOutputLines(event.output ?? "");
  for (const line of outputLines.slice(1, 4)) {
    lines.push(colorText(`⎿ out: ${truncate(line, previewMaxChars)}`, DIM_GRAY));
  }
  if (outputLines.length === 0) {
    lines.push(colorText("⎿ out: (no output)", DIM_GRAY));
  }
  if (event.metadata) {
    lines.push(colorText(`⎿ meta: ${truncate(JSON.stringify(event.metadata), previewMaxChars)}`, DIM_GRAY));
  }

  return lines.join("\n");
}
