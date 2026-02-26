/** Main TUI orchestrator using Ink. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createDefaultRegistry, parseCommand } from "#agent/commands/commands";
import type { CommandRegistry, SessionContext } from "#agent/commands/commands";
import { saveConfig } from "#config/config";
import {
  colorText,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  horizontalGradientAtOffset,
  INPUT_PINK
} from "#ui/colors";
import { LlamaClient } from "#llm/llama-client";
import type { ChatResult } from "#llm/llama-client";
import {
  ensureLlamaReady,
  formatLlamaStartupFailure,
  isLocalLlamaEndpoint,
  resetLlamaForFreshSession,
  stopLlamaServer
} from "#llm/llama-server";
import {
  formatActionCallBox,
  formatActionResultBox,
  formatAssistantMessage,
  formatDimMessage,
  formatErrorMessage,
  formatUserMessage,
  formatWarningMessage
} from "#ui/messages";
import { PulsingSpinner } from "#ui/spinner";
import { buildPromptBoxFrame } from "#ui/prompt/prompt-box";
import {
  PromptComposer,
  type ModelAutocompleteCandidate,
  type PromptComposerEvent,
  type PromptComposerLayout
} from "#ui/prompt/prompt-composer";
import { InputEngine, type InputAction } from "#ui/input/input-engine";
import { renderDownloaderLines } from "#ui/downloader/downloader-ui";
import {
  closeCancelConfirm,
  DOWNLOADER_TABS,
  closeFileView,
  createDownloaderState,
  cycleTab,
  finishDownload,
  getCachedModels,
  moveFileSelection,
  moveModelSelection,
  openCancelConfirm,
  resetModelCache,
  setCachedModels,
  setDownloaderError,
  setFiles,
  setLoadingFiles,
  setLoadingModels,
  setPreloadingTabs,
  setModels,
  startDownload,
  tabToSort,
  updateDownloadProgress,
  type DownloaderState
} from "#ui/downloader/downloader-state";
import { getSystemSpecs } from "#models/hardware";
import { deleteLocalModel, getFriendlyModelName, listLocalModels } from "#models/model-manager";
import { renderModelManagerLines } from "#ui/model-manager/model-manager-ui";
import {
  createModelManagerState,
  getSelectedModel,
  moveModelManagerSelection,
  removeModelById,
  setModelManagerError,
  setModelManagerLoading,
  setModelManagerModels,
  setModelManagerSearchQuery,
  type ModelManagerState
} from "#ui/model-manager/model-manager-state";
import {
  createSetupState,
  getSelectedSetupChannel,
  moveSetupSelection,
  type SetupState
} from "#ui/setup/setup-state";
import { renderSetupLines } from "#ui/setup/setup-ui";
import {
  downloadModelFile,
  listGgufModels,
  listModelFiles,
  type HfModelSummary
} from "#models/model-downloader";
import { renderTitleBox } from "#ui/title-box";
import type { TitleBoxOptions } from "#ui/title-box";
import {
  computeAutoMaxTokens,
  estimateConversationTokens,
  formatTitleTokenUsage,
  resolveEffectiveMaxTokens
} from "#llm/token-counter";
import { runConductorTurn, type ConductorAssistantReply } from "#agent/conductor";
import { formatHookFailure, runHook, type HookRunResult } from "#config/hooks";
import {
  createSessionFileFromHistory,
  listSessions,
  loadSession,
  writeSessionFile,
  type SessionListItem
} from "#agent/context/session-store";
import type {
  AppConfig,
  ChatMessage,
  SkillCall,
  SkillResult,
  SubagentCall,
  SubagentResult,
  ToolCall,
  ToolResult,
  TuiOptions
} from "#types/app-types";
import {
  assessActionRisk,
  type ActionRiskAssessment
} from "#agent/tools/action-risk-policy";
import { FileChangeStore } from "#agent/tools/file-change-store";
import { executeToolCall } from "#agent/tools/tool-executor";
import { executeSkillCall } from "#agent/skills/skills";
import { VirtualTerminalSession } from "#ui/input/vt-session";
import { loadCodeContext, toCodeContextSystemMessage } from "#agent/context/code-context";
import { decideConfirmationAction, routeVtInput } from "#ui/input/tui-input-routing";
import { composeChatRequestMessages } from "#agent/protocol/system-prompt";
import { parseAgentEnvelope } from "#agent/protocol/agent-envelope";

const PROMPT_PREFIX = ">>> ";
const CURSOR_MARKER = "▌";
const KEY_DEBUG_ENABLED = process.env["YIPS_DEBUG_KEYS"] === "1";
const ANSI_REVERSE_ON = "\u001b[7m";
const ANSI_RESET_ALL = "\u001b[0m";
const DOWNLOADER_MIN_SEARCH_CHARS = 3;
const DOWNLOADER_SEARCH_DEBOUNCE_MS = 400;
const DOWNLOADER_PROGRESS_RENDER_INTERVAL_MS = 200;
const BUSY_SPINNER_RENDER_INTERVAL_MS = 16;
const STREAM_RENDER_INTERVAL_MS = 33;
const MOUSE_SCROLL_LINE_STEP = 3;
const ENABLE_MOUSE_REPORTING = "\u001b[?1000h\u001b[?1006h";
const DISABLE_MOUSE_REPORTING = "\u001b[?1000l\u001b[?1006l";
const ANSI_SGR_PATTERN = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

interface RuntimeState {
  outputLines: string[];
  outputScrollOffset: number;
  running: boolean;
  config: AppConfig;
  messageCount: number;
  username: string;
  sessionName: string;
  inputHistory: string[];
  history: ChatMessage[];
  busy: boolean;
  busyLabel: string;
  uiMode: "chat" | "downloader" | "model-manager" | "setup" | "sessions" | "vt" | "confirm";
  downloader: DownloaderState | null;
  modelManager: ModelManagerState | null;
  setup: SetupState | null;
  sessionFilePath: string | null;
  sessionCreated: boolean;
  recentActivity: string[];
  sessionList: SessionListItem[];
  sessionSelectionIndex: number;
  usedTokensExact: number | null;
  latestOutputTokensPerSecond: number | null;
  modelAutocompleteCandidates: ModelAutocompleteCandidate[];
  pendingConfirmation: PendingConfirmation | null;
  codeContextPath: string | null;
  codeContextMessage: string | null;
  mouseCaptureEnabled: boolean;
}

interface PendingConfirmation {
  summary: string;
  reasons: string[];
}

interface AssistantRequestOptions {
  streamingOverride?: boolean;
  historyOverride?: readonly ChatMessage[];
  codeContextOverride?: string | null;
  busyLabel?: string;
}

export interface InkModule {
  render: (
    node: React.ReactNode,
    options?: { exitOnCtrlC?: boolean }
  ) => { waitUntilExit: () => Promise<void> };
  Box: React.ComponentType<{
    flexDirection?: "row" | "column";
    children?: React.ReactNode;
  }>;
  Text: React.ComponentType<{ children?: React.ReactNode }>;
  useApp: () => { exit: (error?: Error) => void };
  useStdin: () => {
    stdin: NodeJS.ReadStream;
    setRawMode: (value: boolean) => void;
    isRawModeSupported: boolean;
  };
  useStdout: () => {
    stdout: NodeJS.WriteStream;
    write: (data: string) => void;
  };
}

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

export function resolveModelLoadTarget(config: AppConfig): "GPU" | "CPU" {
  return config.llamaGpuLayers > 0 ? "GPU" : "CPU";
}

export function formatModelLoadingLabel(
  config: AppConfig,
  nicknames: Record<string, string>
): string {
  const loadedModel = resolveLoadedModel(config.model);
  const modelLabel = loadedModel ? getFriendlyModelName(loadedModel, nicknames) : "model";
  const target = resolveModelLoadTarget(config);
  return `Loading ${modelLabel} into ${target}...`;
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex >= 2 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export async function runOnceGuarded(
  guard: { current: boolean },
  operation: () => Promise<void>
): Promise<boolean> {
  if (guard.current) {
    return false;
  }
  guard.current = true;
  await operation();
  return true;
}

export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
}

export async function flushUiRender(render: () => void): Promise<void> {
  render();
  await yieldToUi();
}

function formatEta(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatDownloadStatus(options: {
  bytesDownloaded: number;
  totalBytes: number | null;
  startedAtMs: number;
}): string {
  const elapsedSeconds = Math.max(0.001, (Date.now() - options.startedAtMs) / 1000);
  const bytesPerSecond = options.bytesDownloaded / elapsedSeconds;
  const speedText = `${formatBytes(bytesPerSecond)}/s`;

  if (options.totalBytes === null || options.totalBytes <= 0) {
    return `${formatBytes(options.bytesDownloaded)} downloaded | ${speedText}`;
  }

  const remainingBytes = Math.max(0, options.totalBytes - options.bytesDownloaded);
  const etaSeconds = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;
  return `${formatBytes(options.bytesDownloaded)} / ${formatBytes(options.totalBytes)} | ${speedText} | ETA ${formatEta(etaSeconds)}`;
}

export function computeTokensPerSecond(tokens: number, durationMs: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(durationMs)) {
    return null;
  }
  if (tokens <= 0 || durationMs <= 0) {
    return null;
  }
  return tokens / (durationMs / 1000);
}

export function formatTokensPerSecond(tokensPerSecond: number): string {
  const safe = Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? tokensPerSecond : 0;
  return `${safe.toFixed(1)} tk/s`;
}

function toDebugText(input: string): string {
  return Array.from(input)
    .map((char) => {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return "";
      if (codePoint === 0x1b) return "<ESC>";
      if (codePoint === 0x0d) return "<CR>";
      if (codePoint === 0x0a) return "<LF>";
      if (codePoint === 0x08) return "<BS>";
      if (codePoint === 0x7f) return "<DEL>";
      if (codePoint < 0x20 || codePoint === 0x7f) {
        return `<0x${codePoint.toString(16).padStart(2, "0")}>`;
      }
      return char;
    })
    .join("");
}

function toDebugBytes(input: string): string {
  return Array.from(Buffer.from(input, "latin1"))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

export function formatTitleCwd(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : "/";
}

function buildTitleBoxOptions(
  state: RuntimeState,
  version: string,
  width: number
): TitleBoxOptions {
  const loadedModel = resolveLoadedModel(state.config.model);
  const modelLabel = loadedModel ? getFriendlyModelName(loadedModel, state.config.nicknames) : "";
  let tokenUsage = "";
  if (loadedModel) {
    const modelSizeBytes = resolveLoadedModelSizeBytes(state.config, loadedModel);
    const autoMax = computeAutoMaxTokens({
      ramGb: getSystemSpecs().ramGb,
      modelSizeBytes
    });
    const maxTokens = resolveEffectiveMaxTokens(
      state.config.tokensMode,
      state.config.tokensManualMax,
      autoMax
    );
    tokenUsage = formatTitleTokenUsage(state.usedTokensExact ?? 0, maxTokens);
  }
  return {
    width,
    version,
    username: state.username,
    backend: formatBackendName(state.config.backend),
    model: modelLabel,
    tokenUsage,
    cwd: formatTitleCwd(process.cwd()),
    sessionName: state.sessionName,
    recentActivity: state.recentActivity,
    sessionSelection:
      state.uiMode === "sessions"
        ? {
            active: true,
            selectedIndex: state.sessionSelectionIndex
          }
        : undefined
  };
}

function resolveLoadedModelSizeBytes(config: AppConfig, loadedModel: string): number {
  try {
    const modelsDir = resolve(config.llamaModelsDir);
    const modelPath = resolve(join(modelsDir, loadedModel));
    const stats = statSync(modelPath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

export function buildPromptStatusText(state: RuntimeState): string {
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

export function composeFullTranscriptLines(sections: {
  titleLines: readonly string[];
  outputLines: readonly string[];
  promptLines: readonly string[];
}): string[] {
  return [...sections.titleLines, ...sections.outputLines, ...sections.promptLines];
}

interface RuntimeRenderLines {
  titleLines: string[];
  outputLines: string[];
  promptLines: string[];
}

function shiftOutputScrollOffsetWithCap(
  state: RuntimeState,
  delta: number,
  maxOffsetCap: number
): void {
  const next = state.outputScrollOffset + delta;
  const clampedCap = Math.max(0, maxOffsetCap);
  state.outputScrollOffset = Math.max(0, Math.min(clampedCap, next));
}

function appendOutput(state: RuntimeState, text: string): void {
  const lines = text.split("\n");
  for (const line of lines) {
    state.outputLines.push(line);
  }
  state.outputScrollOffset = 0;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}

function isVisuallyEmptyLine(line: string): boolean {
  return stripAnsi(line).trim().length === 0;
}

const TITLE_OUTPUT_GAP_ROWS = 1;

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
  // Keep the very first visible content row anchored when fully scrolled up.
  // For wrapped first lines, this still allows scrolling through later wrapped rows.
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

function pruneModelSwitchStatusArtifacts(state: RuntimeState): void {
  const keep: string[] = [];
  for (const line of state.outputLines) {
    const plain = stripAnsi(line).trim();
    const isArtifact =
      plain.startsWith("Model set to: ") ||
      plain === "Model preload complete." ||
      /^Loading .+ into (GPU|CPU)\.\.\.$/.test(plain);
    if (!isArtifact) {
      keep.push(line);
    }
  }

  while (keep.length > 0 && keep[keep.length - 1]?.trim().length === 0) {
    keep.pop();
  }

  state.outputLines = keep;
  state.outputScrollOffset = 0;
}

function replaceOutputBlock(
  state: RuntimeState,
  start: number,
  count: number,
  text: string
): number {
  const lines = text.split("\n");
  state.outputLines.splice(start, count, ...lines);
  state.outputScrollOffset = 0;
  return lines.length;
}

function stripEnvelopeStart(text: string): string {
  const yipsAgentIndex = text.indexOf("```yips-agent");
  const yipsToolsIndex = text.indexOf("```yips-tools");
  const candidates = [yipsAgentIndex, yipsToolsIndex].filter((value) => value >= 0);
  if (candidates.length === 0) {
    return text;
  }
  const firstIndex = Math.min(...candidates);
  return text.slice(0, firstIndex).trimEnd();
}

function hasEnvelopeStart(text: string): boolean {
  return text.includes("```yips-agent") || text.includes("```yips-tools");
}

function extractBareEnvelopeAssistantText(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const hasActionShape =
    Array.isArray(record["actions"]) ||
    Array.isArray(record["tool_calls"]) ||
    Array.isArray(record["skill_calls"]) ||
    Array.isArray(record["subagent_calls"]);
  if (!hasActionShape) {
    return null;
  }

  const assistantText = record["assistant_text"];
  if (typeof assistantText !== "string" || assistantText.trim().length === 0) {
    return "";
  }
  return assistantText.trim();
}

export function renderAssistantStreamForDisplay(
  rawText: string,
  timestamp: Date,
  verbose: boolean
): string {
  void verbose;
  const parsed = parseAgentEnvelope(rawText);
  if (!parsed.envelopeFound) {
    const bareAssistantText = extractBareEnvelopeAssistantText(rawText);
    if (bareAssistantText !== null) {
      if (bareAssistantText.length === 0) {
        return "";
      }
      return formatAssistantMessage(bareAssistantText, timestamp);
    }
    if (hasEnvelopeStart(rawText)) {
      const prefix = stripEnvelopeStart(rawText);
      if (prefix.trim().length === 0) {
        return "";
      }
      return formatAssistantMessage(prefix, timestamp);
    }
    return formatAssistantMessage(rawText, timestamp);
  }

  const lines: string[] = [];
  const assistantText = parsed.assistantText.trim();
  if (assistantText.length > 0) {
    lines.push(...formatAssistantMessage(assistantText, timestamp).split("\n"));
  } else {
    const fallback = stripEnvelopeStart(rawText);
    if (fallback.trim().length > 0) {
      lines.push(...formatAssistantMessage(fallback, timestamp).split("\n"));
    }
  }

  for (const warning of parsed.warnings) {
    lines.push(formatWarningMessage(`Tool protocol warning: ${warning}`));
  }
  for (const error of parsed.errors) {
    lines.push(formatWarningMessage(`Tool protocol error: ${error}`));
  }

  return lines.join("\n");
}

function renderAssistantStreamPreview(rawText: string, timestamp: Date): string {
  if (hasEnvelopeStart(rawText)) {
    const prefix = stripEnvelopeStart(rawText);
    if (prefix.trim().length === 0) {
      return "";
    }
    return formatAssistantMessage(prefix, timestamp);
  }

  return formatAssistantMessage(rawText, timestamp);
}

function resetSession(state: RuntimeState): void {
  state.outputLines = [];
  state.outputScrollOffset = 0;
  state.messageCount = 0;
  state.history = [];
  state.sessionFilePath = null;
  state.sessionCreated = false;
  state.sessionName = "";
  state.usedTokensExact = null;
  state.latestOutputTokensPerSecond = null;
  state.pendingConfirmation = null;
}

export function renderHistoryLines(history: readonly ChatMessage[]): {
  lines: string[];
  userCount: number;
} {
  const lines: string[] = [];
  let userCount = 0;

  for (const entry of history) {
    if (entry.role === "user") {
      userCount += 1;
      lines.push(...formatUserMessage(entry.content).split("\n"));
      continue;
    }

    if (entry.role === "assistant") {
      lines.push(...formatAssistantMessage(entry.content).split("\n"));
      lines.push("");
      continue;
    }

    lines.push(...formatDimMessage(`[system] ${entry.content}`).split("\n"));
  }

  return { lines, userCount };
}

function replayOutputFromHistory(state: RuntimeState): void {
  const rendered = renderHistoryLines(state.history);
  state.outputLines = rendered.lines;
  state.outputScrollOffset = 0;
  state.messageCount = rendered.userCount;
}

function createRuntimeState(options: TuiOptions): RuntimeState {
  const modelOverride = options.model?.trim();
  const runtimeConfig: AppConfig = {
    ...options.config,
    model: modelOverride && modelOverride.length > 0 ? modelOverride : options.config.model
  };

  return {
    outputLines: [],
    outputScrollOffset: 0,
    running: true,
    config: runtimeConfig,
    messageCount: 0,
    username: options.username ?? process.env["USER"] ?? "user",
    sessionName: options.sessionName ?? "",
    inputHistory: [],
    history: [],
    busy: false,
    busyLabel: "",
    uiMode: "chat",
    downloader: null,
    modelManager: null,
    setup: null,
    sessionFilePath: null,
    sessionCreated: false,
    recentActivity: [],
    sessionList: [],
    sessionSelectionIndex: 0,
    usedTokensExact: null,
    latestOutputTokensPerSecond: null,
    modelAutocompleteCandidates: [],
    pendingConfirmation: null,
    codeContextPath: null,
    codeContextMessage: null,
    mouseCaptureEnabled: false
  };
}

function buildSubagentScopeMessage(call: SubagentCall): string {
  const lines = [
    "Subagent scope:",
    `Task: ${call.task}`,
    call.context ? `Context: ${call.context}` : null,
    call.allowedTools
      ? `Allowed tools: ${call.allowedTools.length > 0 ? call.allowedTools.join(", ") : "(none)"}`
      : "Allowed tools: all available tools",
    "Stay focused on the delegated scope and return concise findings."
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export function buildModelAutocompleteCandidates(
  modelIds: readonly string[]
): ModelAutocompleteCandidate[] {
  const candidates: ModelAutocompleteCandidate[] = [];
  const seenValues = new Set<string>();

  for (const rawModelId of modelIds) {
    const value = rawModelId.trim();
    if (value.length === 0 || seenValues.has(value)) {
      continue;
    }
    seenValues.add(value);

    const aliases: string[] = [];
    const parentPath = value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
    if (parentPath.length > 0) {
      aliases.push(parentPath);
    }

    const segments = value.split("/").filter((segment) => segment.length > 0);
    if (segments.length >= 2) {
      aliases.push(`${segments[0]}/${segments[1]}`);
    }

    const filename = basename(value);
    if (filename.length > 0) {
      aliases.push(filename);
      if (filename.toLowerCase().endsWith(".gguf")) {
        aliases.push(filename.slice(0, -5));
      }
    }

    const dedupedAliases = [
      ...new Set(aliases.filter((alias) => alias.length > 0 && alias !== value))
    ];
    candidates.push({
      value,
      aliases: dedupedAliases
    });
  }

  return candidates;
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

interface VisibleLayoutSlices {
  titleLines: string[];
  outputLines: string[];
  promptLines: string[];
}

const MAX_AUTOCOMPLETE_PREVIEW = 8;

function withReverseHighlight(text: string): string {
  return `${ANSI_REVERSE_ON}${text}${ANSI_RESET_ALL}`;
}

export function shouldConsumeSubmitForAutocomplete(
  menu: {
    token: string;
    options: string[];
    selectedIndex: number;
  } | null
): boolean {
  if (!menu) {
    return false;
  }
  const selected = menu.options[menu.selectedIndex];
  if (!selected) {
    return false;
  }
  return selected !== menu.token;
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

  // Output should first consume only the empty space between title and prompt.
  // Once that gap is exhausted, additional output lines start pushing the title up.
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

export function buildAutocompleteOverlayLines(
  composer: PromptComposer,
  registry: CommandRegistry
): string[] {
  const menu = composer.getAutocompleteMenuState();
  if (!menu) {
    return [];
  }

  const descriptorBySlashName = new Map(
    registry.listCommands().map((descriptor) => [`/${descriptor.name}`, descriptor])
  );

  const lines: string[] = [];

  const windowSize = Math.min(MAX_AUTOCOMPLETE_PREVIEW, menu.options.length);
  const startIndex = Math.max(
    0,
    Math.min(menu.selectedIndex - Math.floor(windowSize / 2), menu.options.length - windowSize)
  );
  const visibleOptions = menu.options.slice(startIndex, startIndex + windowSize);
  const commandColumnWidth = Math.max(10, ...visibleOptions.map((option) => charLength(option)));
  // Align the command slash with the slash in the prompt row: "│>>> /..."
  const leftPadding = " ".repeat(1 + charLength(PROMPT_PREFIX));

  for (let rowIndex = 0; rowIndex < visibleOptions.length; rowIndex++) {
    const option = visibleOptions[rowIndex] ?? "";
    const descriptor = descriptorBySlashName.get(option);
    const description =
      descriptor?.description ?? (option.startsWith("/") ? "Command" : "Local model");
    const commandColor = descriptor?.kind === "skill" ? INPUT_PINK : GRADIENT_BLUE;
    const selected = startIndex + rowIndex === menu.selectedIndex;
    const paddedCommand = option.padEnd(commandColumnWidth, " ");
    const styledCommand = colorText(paddedCommand, commandColor);
    const styledDescription = horizontalGradient(description, GRADIENT_PINK, GRADIENT_YELLOW);
    const rowText = `${leftPadding}${styledCommand}   ${styledDescription}`;
    lines.push(selected ? withReverseHighlight(rowText) : rowText);
  }

  return lines;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }
  return error.message.toLowerCase().includes("aborted");
}

function formatInputAction(action: InputAction): string {
  switch (action.type) {
    case "insert":
      return `insert(${JSON.stringify(action.text)})`;
    case "submit":
    case "newline":
    case "scroll-page-up":
    case "scroll-page-down":
    case "scroll-line-up":
    case "scroll-line-down":
    case "backspace":
    case "delete":
    case "move-left":
    case "move-right":
    case "move-up":
    case "move-down":
    case "home":
    case "end":
    case "cancel":
    case "tab":
      return action.type;
  }
}

function isAmbiguousPlainEnterChunk(sequence: string, actions: InputAction[]): boolean {
  if (!actions.some((action) => action.type === "submit")) {
    return false;
  }
  if (actions.some((action) => action.type === "newline")) {
    return false;
  }
  if (sequence.includes("\x1b")) {
    return false;
  }

  const bytes = Array.from(Buffer.from(sequence, "latin1"));
  if (bytes.length === 1 && bytes[0] === 0x0d) {
    return true;
  }
  if (bytes.length === 2 && bytes[0] === 0x0d && bytes[1] === 0x0a) {
    return true;
  }

  return false;
}

function applyInputAction(
  composer: PromptComposer,
  action: InputAction
): PromptComposerEvent | null {
  switch (action.type) {
    case "insert":
      for (const char of Array.from(action.text)) {
        composer.handleKey(char, { isCharacter: true });
      }
      return null;
    case "newline":
      return composer.handleKey("CTRL_ENTER");
    case "scroll-page-up":
    case "scroll-page-down":
    case "scroll-line-up":
    case "scroll-line-down":
      return null;
    case "submit":
      return composer.handleKey("ENTER");
    case "backspace":
      return composer.handleKey("BACKSPACE");
    case "delete":
      return composer.handleKey("DELETE");
    case "move-left":
      return composer.handleKey("LEFT");
    case "move-right":
      return composer.handleKey("RIGHT");
    case "move-up":
      return composer.handleKey("UP");
    case "move-down":
      return composer.handleKey("DOWN");
    case "home":
      return composer.handleKey("HOME");
    case "end":
      return composer.handleKey("END");
    case "tab":
      return null;
    case "cancel":
      return { type: "cancel" };
  }
}

interface InkAppProps {
  options: TuiOptions;
  version: string;
  onRestartRequested: () => void;
  onExitTranscript: (lines: readonly string[]) => void;
}

export function createInkApp(ink: InkModule): React.FC<InkAppProps> {
  const { Box, Text, useApp, useStdin, useStdout } = ink;

  return function InkApp({ options, version, onRestartRequested, onExitTranscript }) {
    const { exit } = useApp();
    const { stdin, isRawModeSupported, setRawMode } = useStdin();
    const { stdout } = useStdout();

    const [dimensions, setDimensions] = useState(() => ({
      columns: stdout.columns ?? 80,
      rows: stdout.rows ?? 24
    }));
    const [, setRenderVersion] = useState(0);

    const stateRef = useRef<RuntimeState | null>(null);
    const registryRef = useRef<CommandRegistry>(createDefaultRegistry());
    const composerRef = useRef<PromptComposer | null>(null);
    const llamaClientRef = useRef<LlamaClient | null>(null);
    const inputEngineRef = useRef<InputEngine>(new InputEngine());
    const dimensionsRef = useRef(dimensions);
    const downloaderSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
    const downloaderPreloadJobRef = useRef(0);
    const downloaderSearchInFlightRef = useRef(false);
    const downloaderPendingQueryRef = useRef<string | null>(null);
    const downloaderProgressDirtyRef = useRef(false);
    const downloaderProgressBufferRef = useRef<{
      bytesDownloaded: number;
      totalBytes: number | null;
    } | null>(null);
    const downloaderAbortControllerRef = useRef<AbortController | null>(null);
    const busySpinnerRef = useRef<PulsingSpinner | null>(null);
    const vtSessionRef = useRef<VirtualTerminalSession | null>(null);
    const fileChangeStoreRef = useRef<FileChangeStore | null>(null);
    const confirmResolverRef = useRef<((approved: boolean) => void) | null>(null);
    const vtEscapePendingRef = useRef(false);
    const sessionStartHookRanRef = useRef(false);
    const sessionEndHookRanRef = useRef(false);
    const startupWarningSeenRef = useRef(new Set<string>());

    const forceRender = useCallback(() => {
      setRenderVersion((value) => value + 1);
    }, []);

    const startBusyIndicator = useCallback(
      (label: string): void => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }
        if (!busySpinnerRef.current) {
          busySpinnerRef.current = new PulsingSpinner(label);
        }
        busySpinnerRef.current.start(label);
        currentState.busy = true;
        currentState.busyLabel = label;
        forceRender();
      },
      [forceRender]
    );

    const stopBusyIndicator = useCallback((): void => {
      const currentState = stateRef.current;
      if (!currentState) {
        return;
      }
      busySpinnerRef.current?.stop();
      currentState.busy = false;
      currentState.busyLabel = "";
      forceRender();
    }, [forceRender]);

    const runWithBusyLabel = useCallback(
      async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
        startBusyIndicator(label);
        await flushUiRender(forceRender);
        try {
          return await run();
        } finally {
          stopBusyIndicator();
          await flushUiRender(forceRender);
        }
      },
      [forceRender, startBusyIndicator, stopBusyIndicator]
    );

    const flushUi = useCallback(async (): Promise<void> => {
      await flushUiRender(forceRender);
    }, [forceRender]);

    dimensionsRef.current = dimensions;

    if (!stateRef.current) {
      const state = createRuntimeState(options);
      stateRef.current = state;
    }

    const state = stateRef.current;

    if (!llamaClientRef.current) {
      llamaClientRef.current = new LlamaClient({
        baseUrl: state.config.llamaBaseUrl,
        model: state.config.model
      });
    }

    const createComposer = useCallback((seedText?: string): PromptComposer => {
      const currentState = stateRef.current;
      if (!currentState) {
        throw new Error("Runtime state is not initialized.");
      }

      return new PromptComposer({
        interiorWidth: Math.max(0, dimensionsRef.current.columns - 2),
        history: [...currentState.inputHistory],
        commandAutoComplete: registryRef.current.getAutocompleteCommands(),
        modelAutoComplete: currentState.modelAutocompleteCandidates,
        prefix: PROMPT_PREFIX,
        text: seedText
      });
    }, []);

    const getVtSession = useCallback((): VirtualTerminalSession => {
      if (!vtSessionRef.current) {
        vtSessionRef.current = new VirtualTerminalSession();
      }
      return vtSessionRef.current;
    }, []);

    const buildRuntimeRenderLines = useCallback(
      (
        currentState: RuntimeState,
        currentDimensions: { columns: number; rows: number },
        includeAutocomplete: boolean
      ): RuntimeRenderLines => {
        const composer = composerRef.current ?? createComposer();
        composerRef.current = composer;
        composer.setInteriorWidth(Math.max(0, currentDimensions.columns - 2));

        const promptLayout = composer.getLayout();
        const statusText = buildPromptStatusText(currentState);
        const titleLines = renderTitleBox(
          buildTitleBoxOptions(currentState, version, currentDimensions.columns)
        );
        const promptLines = buildPromptRenderLines(
          currentDimensions.columns,
          statusText,
          promptLayout,
          true
        );
        const autocompleteOverlay =
          includeAutocomplete &&
          currentState.uiMode !== "downloader" &&
          currentState.uiMode !== "model-manager" &&
          currentState.uiMode !== "setup" &&
          currentState.uiMode !== "sessions" &&
          currentState.uiMode !== "vt" &&
          currentState.uiMode !== "confirm"
            ? buildAutocompleteOverlayLines(composer, registryRef.current)
            : [];

        const busyLine =
          currentState.busy && busySpinnerRef.current ? busySpinnerRef.current.render() : "";
        const outputLines = composeOutputLines({
          outputLines: currentState.outputLines,
          autocompleteOverlay,
          busyLine
        });

        if (currentState.uiMode === "downloader" && currentState.downloader) {
          outputLines.push("");
          outputLines.push(
            ...renderDownloaderLines({
              width: currentDimensions.columns,
              state: currentState.downloader
            })
          );
        }
        if (currentState.uiMode === "model-manager" && currentState.modelManager) {
          outputLines.push("");
          outputLines.push(
            ...renderModelManagerLines({
              width: currentDimensions.columns,
              state: currentState.modelManager,
              currentModel: currentState.config.model
            })
          );
        }
        if (currentState.uiMode === "setup" && currentState.setup) {
          outputLines.push("");
          outputLines.push(
            ...renderSetupLines({
              width: currentDimensions.columns,
              state: currentState.setup,
              channels: currentState.config.channels,
              draftToken: currentState.setup.editingChannel !== null ? composer.getText() : ""
            })
          );
        }
        if (currentState.uiMode === "vt") {
          const vtLines = getVtSession().getDisplayLines(Math.max(8, currentDimensions.rows - 10));
          outputLines.push("");
          outputLines.push(
            horizontalGradient(
              "╭─── Yips Virtual Terminal ───────────────────────────────╮",
              GRADIENT_PINK,
              GRADIENT_YELLOW
            )
          );
          if (vtLines.length === 0) {
            outputLines.push(
              colorText("│ starting shell...                                       │", GRADIENT_BLUE)
            );
          } else {
            for (const line of vtLines.slice(-Math.max(1, currentDimensions.rows - 12))) {
              outputLines.push(line);
            }
          }
          outputLines.push(
            colorText("Esc Esc: return to chat | Ctrl+Q: return to chat", GRADIENT_BLUE)
          );
        }
        if (currentState.uiMode === "confirm" && currentState.pendingConfirmation) {
          const riskTags = currentState.pendingConfirmation.reasons.join(", ");
          outputLines.push("");
          outputLines.push(formatWarningMessage("Confirmation required"));
          outputLines.push(formatDimMessage(`Action: ${currentState.pendingConfirmation.summary}`));
          if (riskTags.length > 0) {
            outputLines.push(formatDimMessage(`Risk: ${riskTags}`));
          }
          outputLines.push(formatDimMessage("Approve? [y/N] (Enter = yes, Esc = no)"));
        }

        return { titleLines, outputLines, promptLines };
      },
      [createComposer, getVtSession, version]
    );

    const getFileChangeStore = useCallback((): FileChangeStore => {
      if (!fileChangeStoreRef.current) {
        fileChangeStoreRef.current = new FileChangeStore();
      }
      return fileChangeStoreRef.current;
    }, []);

    const resolvePendingConfirmation = useCallback(
      (approved: boolean): void => {
        const currentState = stateRef.current;
        const resolver = confirmResolverRef.current;
        confirmResolverRef.current = null;
        if (!currentState || !resolver) {
          return;
        }
        currentState.pendingConfirmation = null;
        currentState.uiMode = "chat";
        resolver(approved);
        forceRender();
      },
      [forceRender]
    );

    const requestToolConfirmation = useCallback(
      async (summary: string, risk: ActionRiskAssessment): Promise<boolean> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return false;
        }
        currentState.pendingConfirmation = {
          summary,
          reasons: risk.reasons
        };
        currentState.uiMode = "confirm";
        forceRender();
        return await new Promise<boolean>((resolveApproval) => {
          confirmResolverRef.current = resolveApproval;
        });
      },
      [forceRender]
    );

    if (!composerRef.current) {
      composerRef.current = createComposer();
    }

    const refreshModelAutocomplete = useCallback(async (): Promise<void> => {
      const currentState = stateRef.current;
      if (!currentState) {
        return;
      }

      const models = await listLocalModels({ nicknames: currentState.config.nicknames });
      const candidates = buildModelAutocompleteCandidates(models.map((model) => model.id));

      const state = stateRef.current;
      if (!state) {
        return;
      }

      state.modelAutocompleteCandidates = candidates;
      composerRef.current?.setModelAutocompleteCandidates(candidates);
      forceRender();
    }, [forceRender]);

    const refreshSessionActivity = useCallback(async (): Promise<void> => {
      const currentState = stateRef.current;
      if (!currentState) {
        return;
      }
      const sessions = await listSessions();
      const state = stateRef.current;
      if (!state) {
        return;
      }
      state.sessionList = sessions;
      state.recentActivity = sessions.slice(0, 5).map((session) => session.display);
      if (state.sessionList.length === 0) {
        state.sessionSelectionIndex = 0;
      } else {
        state.sessionSelectionIndex = Math.max(
          0,
          Math.min(state.sessionSelectionIndex, state.sessionList.length - 1)
        );
      }
      forceRender();
    }, [forceRender]);

    const persistSessionSnapshot = useCallback(async (): Promise<void> => {
      const currentState = stateRef.current;
      if (!currentState || currentState.history.length === 0) {
        return;
      }
      try {
        if (!currentState.sessionCreated || !currentState.sessionFilePath) {
          const created = await createSessionFileFromHistory(currentState.history);
          currentState.sessionFilePath = created.path;
          currentState.sessionName = created.sessionName;
          currentState.sessionCreated = true;
        }
        await writeSessionFile({
          path: currentState.sessionFilePath,
          username: currentState.username,
          history: currentState.history
        });
        await refreshSessionActivity();
      } catch (error) {
        appendOutput(
          currentState,
          formatWarningMessage(`Session save failed: ${formatError(error)}`)
        );
        appendOutput(currentState, "");
        forceRender();
      }
    }, [forceRender, refreshSessionActivity]);

    const maybeRenderHookFailure = useCallback(
      (result: HookRunResult): void => {
        if (result.status === "ok" || result.status === "skipped") {
          return;
        }
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }
        appendOutput(currentState, formatWarningMessage(formatHookFailure(result)));
        appendOutput(currentState, "");
        forceRender();
      },
      [forceRender]
    );

    const runConfiguredHook = useCallback(
      async (
        name: "on-session-start" | "on-session-end" | "on-file-write",
        payload: Record<string, unknown>,
        options?: { surfaceFailure?: boolean }
      ): Promise<HookRunResult> => {
        const currentState = stateRef.current;
        const config = currentState?.config ?? state.config;
        const result = await runHook(config, name, payload, {
          cwd: process.cwd(),
          sessionName: currentState?.sessionName
        });
        if (options?.surfaceFailure !== false) {
          maybeRenderHookFailure(result);
        }
        return result;
      },
      [maybeRenderHookFailure, state.config]
    );

    const renderStartupWarnings = useCallback(
      (warnings: readonly string[]): void => {
        const currentState = stateRef.current;
        if (!currentState || warnings.length === 0) {
          return;
        }
        let dirty = false;
        for (const warning of warnings) {
          const trimmed = warning.trim();
          if (trimmed.length === 0 || startupWarningSeenRef.current.has(trimmed)) {
            continue;
          }
          startupWarningSeenRef.current.add(trimmed);
          appendOutput(currentState, formatWarningMessage(trimmed));
          appendOutput(currentState, "");
          dirty = true;
        }
        if (dirty) {
          forceRender();
        }
      },
      [forceRender]
    );

    const runSessionEndHookOnce = useCallback(
      async (reason: string): Promise<void> => {
        await runOnceGuarded(sessionEndHookRanRef, async () => {
          const currentState = stateRef.current;
          await runConfiguredHook(
            "on-session-end",
            {
              reason,
              messageCount: currentState?.messageCount ?? 0,
              historyCount: currentState?.history.length ?? 0,
              sessionName: currentState?.sessionName ?? ""
            },
            { surfaceFailure: true }
          );
        });
      },
      [runConfiguredHook]
    );

    const finalizeAndExit = useCallback(
      (reason: string, options?: { restart?: boolean }): void => {
        void (async () => {
          const currentState = stateRef.current;
          if (currentState) {
            currentState.running = false;
          }
          await persistSessionSnapshot();
          await runSessionEndHookOnce(reason);
          if (currentState && !options?.restart) {
            const fullLines = buildRuntimeRenderLines(currentState, dimensionsRef.current, true);
            onExitTranscript(composeFullTranscriptLines(fullLines));
          }
          if (options?.restart) {
            onRestartRequested();
          }
          exit();
        })();
      },
      [
        buildRuntimeRenderLines,
        exit,
        onExitTranscript,
        onRestartRequested,
        persistSessionSnapshot,
        runSessionEndHookOnce
      ]
    );

    const loadSessionIntoState = useCallback(
      async (path: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }
        try {
          const loaded = await loadSession(path);
          currentState.history = loaded.history;
          currentState.sessionName = loaded.sessionName;
          currentState.sessionFilePath = loaded.path;
          currentState.sessionCreated = true;
          replayOutputFromHistory(currentState);
          currentState.usedTokensExact = estimateConversationTokens(currentState.history);
          currentState.uiMode = "chat";
          composerRef.current = createComposer();
          await refreshSessionActivity();
          forceRender();
        } catch (error) {
          appendOutput(
            currentState,
            formatErrorMessage(`Load session failed: ${formatError(error)}`)
          );
          appendOutput(currentState, "");
          currentState.uiMode = "chat";
          composerRef.current = createComposer();
          forceRender();
        }
      },
      [createComposer, forceRender, refreshSessionActivity]
    );

    useEffect(() => {
      return () => {
        inputEngineRef.current.reset();
        if (downloaderSearchTimerRef.current) {
          clearTimeout(downloaderSearchTimerRef.current);
          downloaderSearchTimerRef.current = null;
        }
        downloaderPendingQueryRef.current = null;
        downloaderProgressDirtyRef.current = false;
        downloaderProgressBufferRef.current = null;
        downloaderAbortControllerRef.current?.abort();
        downloaderAbortControllerRef.current = null;
        void persistSessionSnapshot().catch(() => undefined);
        void runSessionEndHookOnce("unmount").catch(() => undefined);
        void stopLlamaServer().catch(() => undefined);
        vtSessionRef.current?.dispose();
        vtSessionRef.current = null;
      };
    }, [persistSessionSnapshot, runSessionEndHookOnce]);

    useEffect(() => {
      const session = getVtSession();
      const off = session.onData(() => {
        const currentState = stateRef.current;
        if (currentState?.uiMode === "vt") {
          forceRender();
        }
      });
      return () => {
        off();
      };
    }, [forceRender, getVtSession]);

    useEffect(() => {
      void refreshSessionActivity();
    }, [refreshSessionActivity]);

    useEffect(() => {
      const currentState = stateRef.current;
      void runOnceGuarded(sessionStartHookRanRef, async () => {
        await runConfiguredHook(
          "on-session-start",
          {
            backend: currentState?.config.backend ?? "llamacpp",
            model: currentState?.config.model ?? "default",
            configPath: process.env["YIPS_CONFIG_PATH"] ?? null
          },
          { surfaceFailure: true }
        );
      });
    }, [runConfiguredHook]);

    useEffect(() => {
      void (async () => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }

        const loaded = await loadCodeContext(process.cwd());
        const state = stateRef.current;
        if (!state) {
          return;
        }

        if (!loaded) {
          state.codeContextPath = null;
          state.codeContextMessage = null;
          return;
        }

        state.codeContextPath = loaded.path;
        state.codeContextMessage = toCodeContextSystemMessage(loaded);

        if (state.config.verbose) {
          const suffix = loaded.truncated ? " (truncated)" : "";
          appendOutput(state, formatDimMessage(`Loaded CODE.md: ${loaded.path}${suffix}`));
          appendOutput(state, "");
          forceRender();
        }
      })();
    }, [forceRender]);

    useEffect(() => {
      void refreshModelAutocomplete();
    }, [refreshModelAutocomplete]);

    useEffect(() => {
      const tick = setInterval(() => {
        if (!downloaderProgressDirtyRef.current) {
          return;
        }
        const currentState = stateRef.current;
        if (
          !currentState ||
          currentState.uiMode !== "downloader" ||
          !currentState.downloader ||
          currentState.downloader.phase !== "downloading"
        ) {
          downloaderProgressDirtyRef.current = false;
          downloaderProgressBufferRef.current = null;
          return;
        }
        const pending = downloaderProgressBufferRef.current;
        if (pending && currentState.downloader.download) {
          currentState.downloader = updateDownloadProgress(currentState.downloader, {
            bytesDownloaded: pending.bytesDownloaded,
            totalBytes: pending.totalBytes,
            statusText: formatDownloadStatus({
              bytesDownloaded: pending.bytesDownloaded,
              totalBytes: pending.totalBytes,
              startedAtMs: currentState.downloader.download.startedAtMs
            })
          });
          downloaderProgressBufferRef.current = null;
        }
        downloaderProgressDirtyRef.current = false;
        forceRender();
      }, DOWNLOADER_PROGRESS_RENDER_INTERVAL_MS);

      return () => {
        clearInterval(tick);
      };
    }, [forceRender]);

    useEffect(() => {
      const tick = setInterval(() => {
        const currentState = stateRef.current;
        if (!currentState?.busy || !busySpinnerRef.current?.isActive()) {
          return;
        }
        forceRender();
      }, BUSY_SPINNER_RENDER_INTERVAL_MS);

      return () => {
        clearInterval(tick);
      };
    }, [forceRender]);

    useEffect(() => {
      const onResize = (): void => {
        const next = {
          columns: stdout.columns ?? 80,
          rows: stdout.rows ?? 24
        };
        vtSessionRef.current?.resize(Math.max(20, next.columns - 2), Math.max(8, next.rows - 6));
        setDimensions(next);
      };

      stdout.on("resize", onResize);
      return () => {
        stdout.off("resize", onResize);
      };
    }, [stdout]);

    useEffect(() => {
      const composer = composerRef.current;
      if (!composer) return;
      composer.setInteriorWidth(Math.max(0, dimensions.columns - 2));
      forceRender();
    }, [dimensions.columns, forceRender]);

    useEffect(() => {
      if (!isRawModeSupported) {
        return;
      }

      setRawMode(true);
      return () => {
        setRawMode(false);
      };
    }, [isRawModeSupported, setRawMode]);

    useEffect(() => {
      if (!stdout.isTTY) {
        return;
      }
      stdout.write(state.mouseCaptureEnabled ? ENABLE_MOUSE_REPORTING : DISABLE_MOUSE_REPORTING);
      return () => {
        stdout.write(DISABLE_MOUSE_REPORTING);
      };
    }, [state.mouseCaptureEnabled, stdout]);

    const requestAssistantFromLlama = useCallback(
      async (options?: AssistantRequestOptions): Promise<ConductorAssistantReply> => {
        const currentState = stateRef.current;
        const llamaClient = llamaClientRef.current;
        if (!currentState || !llamaClient) {
          throw new Error("Chat runtime is not initialized.");
        }

        const estimateCompletionTokens = (text: string): number =>
          estimateConversationTokens([{ content: text }]);

        const readiness = await ensureLlamaReady(currentState.config);
        if (!readiness.ready) {
          throw new Error(
            readiness.failure
              ? formatLlamaStartupFailure(readiness.failure, currentState.config)
              : "llama.cpp is unavailable."
          );
        }
        renderStartupWarnings(readiness.warnings ?? []);

        llamaClient.setModel(currentState.config.model);
        const history = options?.historyOverride ?? currentState.history;
        const codeContext =
          options?.codeContextOverride !== undefined
            ? options.codeContextOverride
            : currentState.codeContextMessage;
        const requestMessages = composeChatRequestMessages(history, codeContext ?? null);

        const shouldStream = options?.streamingOverride ?? currentState.config.streaming;
        const busyLabel = options?.busyLabel ?? "Thinking...";

        if (!shouldStream) {
          const startedAtMs = Date.now();
          startBusyIndicator(busyLabel);

          try {
            const result = await llamaClient.chat(requestMessages, currentState.config.model);
            return {
              text: result.text,
              rendered: false,
              totalTokens: result.usage?.totalTokens,
              completionTokens:
                result.usage?.completionTokens ?? estimateCompletionTokens(result.text),
              generationDurationMs: Date.now() - startedAtMs
            };
          } finally {
            stopBusyIndicator();
          }
        }

        const timestamp = new Date();
        let streamText = "";
        let receivedFirstToken = false;
        let streamStartedAtMs: number | null = null;
        const blockStart = currentState.outputLines.length;
        let blockLength = 0;
        let lastRenderAtMs = 0;
        let previewPending = false;

        const renderStreamPreview = (force = false): void => {
          const now = Date.now();
          if (!force && now - lastRenderAtMs < STREAM_RENDER_INTERVAL_MS) {
            previewPending = true;
            return;
          }
          previewPending = false;
          lastRenderAtMs = now;
          blockLength = replaceOutputBlock(
            currentState,
            blockStart,
            blockLength,
            renderAssistantStreamPreview(streamText, timestamp)
          );
          forceRender();
        };

        startBusyIndicator(busyLabel);
        forceRender();

        try {
          const streamResult: ChatResult = await llamaClient.streamChat(
            requestMessages,
            {
              onToken: (token: string): void => {
                if (!receivedFirstToken) {
                  receivedFirstToken = true;
                  streamStartedAtMs = Date.now();
                  stopBusyIndicator();
                }
                streamText += token;
                renderStreamPreview(false);
              }
            },
            currentState.config.model
          );
          streamText = streamResult.text;
          if (previewPending) {
            renderStreamPreview(true);
          }

          if (streamText.length === 0) {
            stopBusyIndicator();
            throw new Error("Streaming response ended without assistant content.");
          }

          blockLength = replaceOutputBlock(
            currentState,
            blockStart,
            blockLength,
            renderAssistantStreamForDisplay(streamText, timestamp, currentState.config.verbose)
          );
          forceRender();

          return {
            text: streamText,
            rendered: true,
            totalTokens: streamResult.usage?.totalTokens,
            completionTokens:
              streamResult.usage?.completionTokens ?? estimateCompletionTokens(streamText),
            generationDurationMs:
              streamStartedAtMs === null ? undefined : Math.max(0, Date.now() - streamStartedAtMs)
          };
        } catch {
          stopBusyIndicator();
          appendOutput(
            currentState,
            formatWarningMessage("Streaming failed. Retrying without streaming.")
          );
          startBusyIndicator("Retrying...");
          const retryStartedAtMs = Date.now();

          try {
            const fallbackResult = await llamaClient.chat(
              requestMessages,
              currentState.config.model
            );
            const fallbackText = fallbackResult.text;
            replaceOutputBlock(
              currentState,
              blockStart,
              blockLength,
              renderAssistantStreamForDisplay(
                fallbackText,
                timestamp,
                currentState.config.verbose
              )
            );
            return {
              text: fallbackText,
              rendered: true,
              totalTokens: fallbackResult.usage?.totalTokens,
              completionTokens:
                fallbackResult.usage?.completionTokens ?? estimateCompletionTokens(fallbackText),
              generationDurationMs: Date.now() - retryStartedAtMs
            };
          } catch (fallbackError) {
            currentState.outputLines.splice(blockStart, blockLength);
            throw fallbackError;
          } finally {
            stopBusyIndicator();
          }
        }
      },
      [forceRender, renderStartupWarnings, startBusyIndicator, stopBusyIndicator]
    );

    const preloadConfiguredModel = useCallback(
      async (forceReloadLocal = false): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }
        if (currentState.config.backend !== "llamacpp") {
          return;
        }
        if (!resolveLoadedModel(currentState.config.model)) {
          return;
        }

        startBusyIndicator(
          formatModelLoadingLabel(currentState.config, currentState.config.nicknames)
        );
        try {
          if (forceReloadLocal && isLocalLlamaEndpoint(currentState.config)) {
            const resetResult = await resetLlamaForFreshSession(currentState.config);
            if (resetResult.failure) {
              throw new Error(formatLlamaStartupFailure(resetResult.failure, currentState.config));
            }
            return;
          }

          const readyResult = await ensureLlamaReady(currentState.config);
          if (!readyResult.ready) {
            throw new Error(
              readyResult.failure
                ? formatLlamaStartupFailure(readyResult.failure, currentState.config)
                : "llama.cpp is unavailable."
            );
          }
          renderStartupWarnings(readyResult.warnings ?? []);
        } finally {
          stopBusyIndicator();
        }
      },
      [renderStartupWarnings, startBusyIndicator, stopBusyIndicator]
    );

    const assessToolCallRisk = useCallback(
      (call: ToolCall, sessionRoot: string): ActionRiskAssessment =>
        assessActionRisk(call, sessionRoot),
      []
    );

    const executeToolCalls = useCallback(
      async (toolCalls: readonly ToolCall[]): Promise<ToolResult[]> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return [];
        }

        const sessionRoot = process.cwd();
        const results: ToolResult[] = [];

        for (const call of toolCalls) {
          appendOutput(
            currentState,
            formatActionCallBox({
              type: "tool",
              id: call.id,
              name: call.name,
              arguments: call.arguments
            }, { verbose: currentState.config.verbose, showIds: currentState.config.verbose })
          );
          await flushUi();

          const risk = assessToolCallRisk(call, sessionRoot);
          if (risk.riskLevel === "deny") {
            const deniedResult: ToolResult = {
              callId: call.id,
              tool: call.name,
              status: "denied",
              output: "Action denied by risk policy."
            };
            results.push(deniedResult);
            appendOutput(
              currentState,
              formatActionResultBox(
                {
                  type: "tool",
                  id: call.id,
                  name: call.name,
                  status: deniedResult.status,
                  output: deniedResult.output
                },
                { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
              )
            );
            appendOutput(currentState, "");
            await flushUi();
            startBusyIndicator("Thinking...");
            await flushUi();
            continue;
          }
          if (risk.requiresConfirmation) {
            const approved = await requestToolConfirmation(`${call.name} (${call.id})`, risk);
            if (!approved) {
              const deniedResult: ToolResult = {
                callId: call.id,
                tool: call.name,
                status: "denied",
                output: "Action denied by user confirmation policy."
              };
              results.push(deniedResult);
              appendOutput(
                currentState,
                formatActionResultBox(
                  {
                    type: "tool",
                    id: call.id,
                    name: call.name,
                    status: deniedResult.status,
                    output: deniedResult.output
                  },
                  { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
                )
              );
              appendOutput(currentState, "");
              await flushUi();
              startBusyIndicator("Thinking...");
              await flushUi();
              continue;
            }
          }

          const result = await runWithBusyLabel(
            `Running ${call.name}...`,
            async () =>
              await executeToolCall(call, {
                workingDirectory: sessionRoot,
                vtSession: getVtSession(),
                fileChangeStore: getFileChangeStore(),
                runHook: async (name, payload) =>
                  await runConfiguredHook(name, payload, { surfaceFailure: false })
              })
          );
          results.push(result);

          appendOutput(
            currentState,
            formatActionResultBox(
              {
                type: "tool",
                id: call.id,
                name: call.name,
                status: result.status,
                output: result.output,
                metadata: result.metadata
              },
              { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
            )
          );
          appendOutput(currentState, "");
          await flushUi();
          startBusyIndicator("Thinking...");
          await flushUi();
        }

        return results;
      },
      [
        assessToolCallRisk,
        flushUi,
        getFileChangeStore,
        getVtSession,
        requestToolConfirmation,
        runWithBusyLabel,
        startBusyIndicator
      ]
    );

    const executeSkillCalls = useCallback(
      async (skillCalls: readonly SkillCall[]): Promise<SkillResult[]> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return [];
        }

        const workingZone = process.cwd();
        const results: SkillResult[] = [];

        for (const call of skillCalls) {
          appendOutput(
            currentState,
            formatActionCallBox({
              type: "skill",
              id: call.id,
              name: call.name,
              arguments: call.arguments
            }, { verbose: currentState.config.verbose, showIds: currentState.config.verbose })
          );
          await flushUi();

          const result = await runWithBusyLabel(
            `Running ${call.name}...`,
            async () =>
              await executeSkillCall(call, {
                workingDirectory: workingZone,
                vtSession: getVtSession()
              })
          );
          results.push(result);

          appendOutput(
            currentState,
            formatActionResultBox(
              {
                type: "skill",
                id: call.id,
                name: call.name,
                status: result.status,
                output: result.output,
                metadata: result.metadata
              },
              { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
            )
          );
          appendOutput(currentState, "");
          await flushUi();
          startBusyIndicator("Thinking...");
          await flushUi();
        }

        return results;
      },
      [flushUi, getVtSession, runWithBusyLabel, startBusyIndicator]
    );

    const executeSubagentCalls = useCallback(
      async (subagentCalls: readonly SubagentCall[]): Promise<SubagentResult[]> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return [];
        }

        const results: SubagentResult[] = [];

        for (const subagentCall of subagentCalls) {
          appendOutput(
            currentState,
            formatActionCallBox({
              type: "subagent",
              id: subagentCall.id,
              name: subagentCall.task
            }, { verbose: currentState.config.verbose, showIds: currentState.config.verbose })
          );
          await flushUi();

          const scopedHistory: ChatMessage[] = [
            { role: "system", content: buildSubagentScopeMessage(subagentCall) },
            { role: "user", content: subagentCall.task }
          ];
          const warnings: string[] = [];
          const allowedTools =
            subagentCall.allowedTools !== undefined ? new Set(subagentCall.allowedTools) : null;
          const startedAtMs = Date.now();

          try {
            const turn = await runWithBusyLabel(
              `Running subagent ${subagentCall.id}...`,
              async () =>
                await runConductorTurn({
                  history: scopedHistory,
                  requestAssistant: () =>
                    requestAssistantFromLlama({
                      streamingOverride: false,
                      historyOverride: scopedHistory,
                      codeContextOverride: null,
                      busyLabel: `Subagent ${subagentCall.id}...`
                    }),
                  executeToolCalls: async (toolCalls: readonly ToolCall[]): Promise<ToolResult[]> => {
                    if (!allowedTools) {
                      return executeToolCalls(toolCalls);
                    }

                    const permittedCalls: ToolCall[] = [];
                    const deniedResults: ToolResult[] = [];

                    for (const call of toolCalls) {
                      if (allowedTools.has(call.name)) {
                        permittedCalls.push(call);
                        continue;
                      }
                      deniedResults.push({
                        callId: call.id,
                        tool: call.name,
                        status: "denied",
                        output: `Tool '${call.name}' is not allowed for subagent ${subagentCall.id}.`
                      });
                    }

                    const permittedResults =
                      permittedCalls.length > 0 ? await executeToolCalls(permittedCalls) : [];
                    return [...deniedResults, ...permittedResults];
                  },
                  executeSkillCalls,
                  onAssistantText: (): void => {
                    // Subagent text is consumed internally and summarized in result metadata.
                  },
                  onWarning: (message: string): void => {
                    warnings.push(message);
                  },
                  onRoundComplete: (): void => {
                    forceRender();
                  },
                  estimateCompletionTokens: (text: string): number =>
                    estimateConversationTokens([{ content: text }]),
                  estimateHistoryTokens: (history: readonly ChatMessage[]): number =>
                    estimateConversationTokens(history),
                  computeTokensPerSecond,
                  maxRounds: subagentCall.maxRounds ?? 4
                })
            );

            const lastAssistant = [...scopedHistory]
              .reverse()
              .find((entry) => entry.role === "assistant")?.content;

            const result: SubagentResult = {
              callId: subagentCall.id,
              status: turn.finished ? "ok" : "timeout",
              output: lastAssistant ?? "Subagent completed without assistant output.",
              metadata: {
                rounds: turn.rounds,
                durationMs: Math.max(0, Date.now() - startedAtMs),
                warnings
              }
            };
            results.push(result);
            appendOutput(
              currentState,
              formatActionResultBox(
                {
                  type: "subagent",
                  id: subagentCall.id,
                  name: subagentCall.task,
                  status: result.status,
                  output: result.output,
                  metadata: result.metadata
                },
                { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
              )
            );
            appendOutput(currentState, "");
            await flushUi();
            startBusyIndicator("Thinking...");
            await flushUi();
          } catch (error) {
            const result: SubagentResult = {
              callId: subagentCall.id,
              status: "error",
              output: `Subagent failed: ${formatError(error)}`
            };
            results.push(result);
            appendOutput(
              currentState,
              formatActionResultBox(
                {
                  type: "subagent",
                  id: subagentCall.id,
                  name: subagentCall.task,
                  status: result.status,
                  output: result.output
                },
                { verbose: currentState.config.verbose, showIds: currentState.config.verbose }
              )
            );
            appendOutput(currentState, "");
            await flushUi();
            startBusyIndicator("Thinking...");
            await flushUi();
          }
        }

        return results;
      },
      [
        executeSkillCalls,
        executeToolCalls,
        flushUi,
        forceRender,
        requestAssistantFromLlama,
        runWithBusyLabel,
        startBusyIndicator
      ]
    );

    const loadDownloaderModels = useCallback(
      async (
        tab: DownloaderState["tab"],
        query: string,
        options?: { showLoading?: boolean; useCache?: boolean }
      ): Promise<HfModelSummary[] | null> => {
        const currentState = stateRef.current;
        if (!currentState || !currentState.downloader) {
          return null;
        }

        const normalizedQuery = query.trim();
        if (options?.useCache !== false) {
          const cached = getCachedModels(currentState.downloader, tab, normalizedQuery);
          if (cached) {
            if (currentState.downloader.tab === tab) {
              currentState.downloader = setModels(currentState.downloader, cached);
              forceRender();
            }
            return cached;
          }
        }

        if (options?.showLoading !== false && currentState.downloader.tab === tab) {
          currentState.downloader = setLoadingModels(
            currentState.downloader,
            "Loading models from Hugging Face..."
          );
          forceRender();
        }

        try {
          const models = await listGgufModels({
            query: normalizedQuery,
            sort: tabToSort(tab),
            limit: 100,
            totalMemoryGb: currentState.downloader.totalMemoryGb
          });

          const state = stateRef.current;
          if (!state || !state.downloader) {
            return null;
          }
          if (state.downloader.cacheQuery !== normalizedQuery) {
            return null;
          }

          let next = setCachedModels(state.downloader, tab, normalizedQuery, models);
          if (
            state.downloader.tab === tab &&
            state.downloader.searchQuery.trim() === normalizedQuery
          ) {
            next = setModels(next, models);
          }
          state.downloader = next;
          forceRender();
          return models;
        } catch (error) {
          const state = stateRef.current;
          if (!state || !state.downloader) {
            return null;
          }
          if (state.downloader.cacheQuery !== normalizedQuery) {
            return null;
          }
          if (state.downloader.tab === tab) {
            state.downloader = setDownloaderError(state.downloader, formatError(error));
            forceRender();
          }
          return null;
        }
      },
      [forceRender]
    );

    const preloadDownloaderTabs = useCallback(
      async (query: string, activeTab: DownloaderState["tab"]): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState || !currentState.downloader) {
          return;
        }
        const normalizedQuery = query.trim();
        const jobId = ++downloaderPreloadJobRef.current;
        currentState.downloader = setPreloadingTabs(currentState.downloader, true);
        forceRender();

        const otherTabs = DOWNLOADER_TABS.filter((tab) => tab !== activeTab);
        await Promise.allSettled(
          otherTabs.map((tab) =>
            loadDownloaderModels(tab, normalizedQuery, { showLoading: false, useCache: true })
          )
        );

        const state = stateRef.current;
        if (!state || !state.downloader) {
          return;
        }
        if (jobId !== downloaderPreloadJobRef.current) {
          return;
        }
        if (state.downloader.cacheQuery !== normalizedQuery) {
          return;
        }
        state.downloader = setPreloadingTabs(state.downloader, false);
        forceRender();
      },
      [forceRender, loadDownloaderModels]
    );

    const normalizeDownloaderQuery = useCallback((query: string): string | null => {
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        return "";
      }
      if (charLength(normalizedQuery) < DOWNLOADER_MIN_SEARCH_CHARS) {
        return null;
      }
      return normalizedQuery;
    }, []);

    const refreshDownloaderQuery = useCallback(
      async (query: string, showLoading: boolean): Promise<void> => {
        const state = stateRef.current;
        if (!state || !state.downloader) {
          return;
        }
        const normalizedQuery = query.trim();
        state.downloader = resetModelCache(state.downloader, normalizedQuery);
        if (showLoading) {
          state.downloader = setLoadingModels(
            state.downloader,
            "Loading models from Hugging Face..."
          );
        }
        forceRender();
        await loadDownloaderModels(state.downloader.tab, normalizedQuery, {
          showLoading: false,
          useCache: false
        });
        void preloadDownloaderTabs(normalizedQuery, state.downloader.tab);
      },
      [forceRender, loadDownloaderModels, preloadDownloaderTabs]
    );

    const drainDownloaderSearchQueue = useCallback((): void => {
      if (downloaderSearchInFlightRef.current) {
        return;
      }

      const run = async (): Promise<void> => {
        downloaderSearchInFlightRef.current = true;
        try {
          for (
            let pendingQuery = downloaderPendingQueryRef.current;
            pendingQuery !== null;
            pendingQuery = downloaderPendingQueryRef.current
          ) {
            downloaderPendingQueryRef.current = null;
            await refreshDownloaderQuery(pendingQuery, true);
          }
        } finally {
          downloaderSearchInFlightRef.current = false;
        }
      };

      void run();
    }, [refreshDownloaderQuery]);

    const scheduleDownloaderSearch = useCallback(
      (query: string, immediate: boolean): void => {
        const state = stateRef.current;
        if (!state || !state.downloader) {
          return;
        }

        if (downloaderSearchTimerRef.current) {
          clearTimeout(downloaderSearchTimerRef.current);
          downloaderSearchTimerRef.current = null;
        }

        const normalizedQuery = normalizeDownloaderQuery(query);
        if (normalizedQuery === null) {
          downloaderPendingQueryRef.current = null;
          state.downloader = {
            ...resetModelCache(state.downloader, query),
            phase: "idle",
            loading: false
          };
          forceRender();
          return;
        }

        downloaderPendingQueryRef.current = normalizedQuery;
        if (immediate) {
          drainDownloaderSearchQueue();
          return;
        }

        downloaderSearchTimerRef.current = setTimeout(() => {
          drainDownloaderSearchQueue();
        }, DOWNLOADER_SEARCH_DEBOUNCE_MS);
      },
      [drainDownloaderSearchQueue, forceRender, normalizeDownloaderQuery]
    );

    const syncDownloaderSearchFromComposer = useCallback(
      (debounced: boolean): void => {
        const currentState = stateRef.current;
        const composer = composerRef.current;
        if (!currentState || !currentState.downloader || !composer) {
          return;
        }

        const searchQuery = composer.getText();
        const previousQuery = currentState.downloader.searchQuery;
        if (searchQuery === previousQuery) {
          return;
        }
        currentState.downloader = {
          ...currentState.downloader,
          searchQuery
        };

        scheduleDownloaderSearch(searchQuery, !debounced);
      },
      [scheduleDownloaderSearch]
    );

    const loadDownloaderFiles = useCallback(
      async (repoId: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState || !currentState.downloader) {
          return;
        }

        currentState.downloader = setLoadingFiles(currentState.downloader, "Loading files...");
        forceRender();

        try {
          const files = await listModelFiles(repoId, {
            totalMemoryGb: currentState.downloader.totalMemoryGb
          });
          const state = stateRef.current;
          if (!state || !state.downloader) {
            return;
          }
          state.downloader = setFiles(state.downloader, repoId, files);
        } catch (error) {
          const state = stateRef.current;
          if (!state || !state.downloader) {
            return;
          }
          state.downloader = setDownloaderError(state.downloader, formatError(error));
        }

        forceRender();
      },
      [forceRender]
    );

    const downloadFromDownloaderSelection = useCallback(async (): Promise<void> => {
      const currentState = stateRef.current;
      if (!currentState || !currentState.downloader) {
        return;
      }
      const file = currentState.downloader.files[currentState.downloader.selectedFileIndex];
      const repoId = currentState.downloader.selectedRepoId;
      if (!file || repoId.trim().length === 0) {
        return;
      }
      if (!file.canRun) {
        currentState.downloader = setDownloaderError(
          currentState.downloader,
          `Cannot download selected file: ${file.reason}`
        );
        forceRender();
        return;
      }

      currentState.downloader = startDownload(
        currentState.downloader,
        repoId,
        file.path,
        `Downloading ${file.path} from ${repoId}...`
      );
      downloaderProgressDirtyRef.current = false;
      downloaderProgressBufferRef.current = null;
      const abortController = new AbortController();
      downloaderAbortControllerRef.current = abortController;
      forceRender();

      try {
        const result = await downloadModelFile({
          repoId,
          filename: file.path,
          signal: abortController.signal,
          onProgress: ({ bytesDownloaded, totalBytes }): void => {
            const state = stateRef.current;
            if (!state || !state.downloader || !state.downloader.download) {
              return;
            }
            downloaderProgressBufferRef.current = {
              bytesDownloaded,
              totalBytes
            };
            downloaderProgressDirtyRef.current = true;
          }
        });

        const state = stateRef.current;
        if (!state || !state.downloader) {
          return;
        }
        appendOutput(
          state,
          formatDimMessage(
            `Downloaded ${file.path} from ${repoId}.\nSaved to: ${result.localPath}\nUse with: /model ${repoId}/${file.path}`
          )
        );
        appendOutput(state, "");
        state.downloader = finishDownload(state.downloader);
        downloaderProgressDirtyRef.current = false;
        downloaderProgressBufferRef.current = null;
        downloaderAbortControllerRef.current = null;
        void refreshModelAutocomplete();
      } catch (error) {
        const state = stateRef.current;
        if (!state || !state.downloader) {
          return;
        }
        if (!isAbortError(error)) {
          state.downloader = setDownloaderError(state.downloader, formatError(error));
        }
        downloaderProgressDirtyRef.current = false;
        downloaderProgressBufferRef.current = null;
        downloaderAbortControllerRef.current = null;
      }

      forceRender();
    }, [forceRender, refreshModelAutocomplete]);

    const refreshModelManagerModels = useCallback(async (): Promise<void> => {
      const currentState = stateRef.current;
      if (!currentState || !currentState.modelManager) {
        return;
      }

      currentState.modelManager = setModelManagerLoading(
        currentState.modelManager,
        "Loading local models..."
      );
      forceRender();

      try {
        const models = await listLocalModels({
          totalMemoryGb: currentState.modelManager.totalMemoryGb,
          nicknames: currentState.config.nicknames
        });
        const state = stateRef.current;
        if (!state || !state.modelManager) {
          return;
        }
        state.modelManager = setModelManagerModels(state.modelManager, models);
      } catch (error) {
        const state = stateRef.current;
        if (!state || !state.modelManager) {
          return;
        }
        state.modelManager = setModelManagerError(state.modelManager, formatError(error));
      }

      forceRender();
    }, [forceRender]);

    const syncModelManagerSearchFromComposer = useCallback((): void => {
      const currentState = stateRef.current;
      const composer = composerRef.current;
      if (!currentState || !currentState.modelManager || !composer) {
        return;
      }

      const query = composer.getText();
      if (query === currentState.modelManager.searchQuery) {
        return;
      }

      currentState.modelManager = setModelManagerSearchQuery(currentState.modelManager, query);
      forceRender();
    }, [forceRender]);

    const handleUserMessage = useCallback(
      async (text: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }

        currentState.messageCount += 1;
        appendOutput(currentState, formatUserMessage(text));
        currentState.history.push({ role: "user", content: text });
        currentState.usedTokensExact = estimateConversationTokens(currentState.history);
        forceRender();

        if (currentState.config.backend !== "llamacpp") {
          const echo = `Echo: ${text}`;
          appendOutput(
            currentState,
            formatWarningMessage(
              `Backend '${currentState.config.backend}' is not implemented yet. Using echo.`
            )
          );
          appendOutput(currentState, formatAssistantMessage(echo));
          appendOutput(currentState, "");
          currentState.history.push({ role: "assistant", content: echo });
          currentState.usedTokensExact = estimateConversationTokens(currentState.history);
          await persistSessionSnapshot();
          forceRender();
          return;
        }

        try {
          const turn = await runConductorTurn({
            history: currentState.history,
            requestAssistant: () => requestAssistantFromLlama(),
            executeToolCalls,
            executeSkillCalls,
            executeSubagentCalls,
            onAssistantText: (assistantText: string, rendered: boolean): void => {
              if (!rendered) {
                appendOutput(currentState, formatAssistantMessage(assistantText));
              }
              appendOutput(currentState, "");
            },
            onWarning: (message: string): void => {
              appendOutput(currentState, formatWarningMessage(message));
              appendOutput(currentState, "");
            },
            onRoundComplete: (): void => {
              forceRender();
            },
            estimateCompletionTokens: (text: string): number =>
              estimateConversationTokens([{ content: text }]),
            estimateHistoryTokens: (history: readonly ChatMessage[]): number =>
              estimateConversationTokens(history),
            computeTokensPerSecond
          });
          currentState.latestOutputTokensPerSecond = turn.latestOutputTokensPerSecond;
          currentState.usedTokensExact = turn.usedTokensExact;
        } catch (error) {
          appendOutput(currentState, formatErrorMessage(`Request failed: ${formatError(error)}`));
          appendOutput(currentState, "");
        }

        await persistSessionSnapshot();
        forceRender();
      },
      [
        executeSubagentCalls,
        executeSkillCalls,
        executeToolCalls,
        forceRender,
        persistSessionSnapshot,
        requestAssistantFromLlama
      ]
    );

    const processSubmittedInput = useCallback(
      async (input: string): Promise<void> => {
        const currentState = stateRef.current;
        if (!currentState) {
          return;
        }

        composerRef.current = createComposer();
        forceRender();

        const trimmed = input.trim();
        if (trimmed.length === 0) return;

        currentState.inputHistory.push(trimmed);

        const parsed = parseCommand(trimmed);

        if (parsed) {
          const context: SessionContext = {
            config: currentState.config,
            messageCount: currentState.messageCount
          };
          const result = await registryRef.current.dispatch(parsed.command, parsed.args, context);
          if (parsed.command === "download" || parsed.command === "dl") {
            void refreshModelAutocomplete();
          }

          const suppressModelSetOutput =
            parsed.command === "model" && parsed.args.trim().length > 0;

          if (result.output && !suppressModelSetOutput) {
            appendOutput(currentState, formatDimMessage(result.output));
            appendOutput(currentState, "");
          }

          if (parsed.command === "model" && parsed.args.trim().length > 0) {
            try {
              pruneModelSwitchStatusArtifacts(currentState);
              await preloadConfiguredModel(true);
            } catch (error) {
              appendOutput(
                currentState,
                formatErrorMessage(`Model preload failed: ${formatError(error)}`)
              );
              appendOutput(currentState, "");
            }
          }

          if (result.action === "clear") {
            resetSession(currentState);
            await refreshSessionActivity();
          }

          if (result.uiAction?.type === "open-downloader") {
            if (!currentState.downloader) {
              const specs = getSystemSpecs();
              currentState.downloader = createDownloaderState(specs);
            }
            currentState.uiMode = "downloader";
            composerRef.current = createComposer(currentState.downloader.searchQuery);
            forceRender();
            scheduleDownloaderSearch(currentState.downloader.searchQuery, true);
            return;
          }

          if (result.uiAction?.type === "open-model-manager") {
            if (!currentState.modelManager) {
              const specs = getSystemSpecs();
              currentState.modelManager = createModelManagerState(specs);
            }
            currentState.uiMode = "model-manager";
            composerRef.current = createComposer(currentState.modelManager.searchQuery);
            forceRender();
            void refreshModelManagerModels();
            return;
          }

          if (result.uiAction?.type === "open-setup") {
            if (!currentState.setup) {
              currentState.setup = createSetupState();
            }
            currentState.uiMode = "setup";
            composerRef.current = createComposer();
            forceRender();
            return;
          }

          if (result.uiAction?.type === "open-sessions") {
            await refreshSessionActivity();
            if (currentState.sessionList.length === 0) {
              appendOutput(currentState, formatDimMessage("No session history found."));
              appendOutput(currentState, "");
              forceRender();
              return;
            }
            currentState.uiMode = "sessions";
            currentState.sessionSelectionIndex = 0;
            composerRef.current = createComposer();
            forceRender();
            return;
          }

          if (result.uiAction?.type === "open-vt") {
            currentState.uiMode = "vt";
            getVtSession().ensureStarted(
              Math.max(20, dimensionsRef.current.columns - 2),
              Math.max(8, dimensionsRef.current.rows - 6)
            );
            forceRender();
            return;
          }

          if (result.uiAction?.type === "set-mouse-capture") {
            const previous = currentState.mouseCaptureEnabled;
            if (result.uiAction.mode === "on") {
              currentState.mouseCaptureEnabled = true;
            } else if (result.uiAction.mode === "off") {
              currentState.mouseCaptureEnabled = false;
            } else if (result.uiAction.mode === "toggle") {
              currentState.mouseCaptureEnabled = !currentState.mouseCaptureEnabled;
            }
            const status = currentState.mouseCaptureEnabled ? "enabled" : "disabled";
            if (result.uiAction.mode === "status") {
              appendOutput(currentState, formatDimMessage(`Mouse capture is ${status}.`));
            } else if (previous !== currentState.mouseCaptureEnabled) {
              appendOutput(
                currentState,
                formatDimMessage(
                  `Mouse capture ${status}. ${status === "enabled" ? "Mouse wheel scroll is active." : "Drag selection/copy is active."}`
                )
              );
            } else {
              appendOutput(currentState, formatDimMessage(`Mouse capture is already ${status}.`));
            }
            appendOutput(currentState, "");
            forceRender();
            return;
          }

          forceRender();

          if (result.action === "exit") {
            finalizeAndExit("command-exit");
          }

          if (result.action === "restart") {
            finalizeAndExit("command-restart", { restart: true });
          }

          return;
        }

        await handleUserMessage(trimmed);
      },
      [
        createComposer,
        finalizeAndExit,
        forceRender,
        handleUserMessage,
        refreshModelAutocomplete,
        refreshSessionActivity,
        refreshModelManagerModels,
        scheduleDownloaderSearch,
        getVtSession,
        preloadConfiguredModel
      ]
    );

    const dispatchComposerEvent = useCallback(
      (event: PromptComposerEvent): void => {
        const composer = composerRef.current;

        if (event.type === "submit") {
          void processSubmittedInput(event.value);
          return;
        }

        if (event.type === "cancel") {
          finalizeAndExit("composer-cancel");
          return;
        }

        if (event.type === "autocomplete-menu") {
          const firstOption = event.options[0];
          if (composer && firstOption) {
            composer.applyAutocompleteChoice(event.tokenStart, event.tokenEnd, firstOption);
          }
        }

        forceRender();
      },
      [finalizeAndExit, forceRender, processSubmittedInput]
    );

    useEffect(() => {
      const onData = (chunk: Buffer | string): void => {
        const currentState = stateRef.current;
        const composer = composerRef.current;
        if (!currentState || !composer) {
          return;
        }

        const sequence = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk);
        const actions = inputEngineRef.current.pushChunk(chunk);

        if (KEY_DEBUG_ENABLED) {
          const actionSummary = actions.map(formatInputAction).join(", ");
          appendOutput(
            currentState,
            formatDimMessage(
              `[debug stdin] bytes=${toDebugBytes(sequence)} text=${toDebugText(sequence)} actions=[${actionSummary}]`
            )
          );
          if (isAmbiguousPlainEnterChunk(sequence, actions)) {
            appendOutput(
              currentState,
              formatWarningMessage(
                "Terminal emitted plain CR for submit; Ctrl+Enter may be indistinguishable from Enter in this terminal config."
              )
            );
          }
          forceRender();
        }

        if (actions.length === 0) {
          return;
        }

        if (currentState.uiMode === "confirm") {
          const decision = decideConfirmationAction(actions);
          if (decision === "approve") {
            resolvePendingConfirmation(true);
            return;
          }
          if (decision === "deny") {
            resolvePendingConfirmation(false);
            return;
          }
          forceRender();
          return;
        }

        if (currentState.uiMode === "vt") {
          const route = routeVtInput(sequence, vtEscapePendingRef.current);
          vtEscapePendingRef.current = route.nextEscapePending;
          if (route.exitToChat) {
            currentState.uiMode = "chat";
            forceRender();
            return;
          }
          if (route.passthrough !== null) {
            getVtSession().write(route.passthrough);
            forceRender();
          }
          return;
        }

        if (currentState.uiMode === "setup") {
          const setup = currentState.setup;
          if (!setup) {
            currentState.uiMode = "chat";
            forceRender();
            return;
          }

          for (const action of actions) {
            if (action.type === "cancel") {
              const latestSetup = currentState.setup;
              if (latestSetup?.editingChannel) {
                currentState.setup = { ...latestSetup, editingChannel: null };
                composerRef.current = createComposer();
              } else {
                currentState.uiMode = "chat";
                composerRef.current = createComposer();
              }
              forceRender();
              return;
            }

            const editing = (currentState.setup?.editingChannel ?? null) !== null;
            if (editing) {
              if (
                action.type === "insert" ||
                action.type === "backspace" ||
                action.type === "delete" ||
                action.type === "home" ||
                action.type === "end" ||
                action.type === "move-left" ||
                action.type === "move-right"
              ) {
                applyInputAction(composer, action);
                forceRender();
                continue;
              }

              if (action.type === "submit") {
                const channel = currentState.setup?.editingChannel;
                if (!channel) {
                  continue;
                }
                const token = composer.getText().trim();
                currentState.config.channels[channel].botToken = token;
                const latestSetup = currentState.setup ?? setup;
                currentState.setup = { ...latestSetup, editingChannel: null };
                composerRef.current = createComposer();
                forceRender();
                void (async () => {
                  const state = stateRef.current;
                  if (!state) {
                    return;
                  }
                  try {
                    await saveConfig(state.config);
                    appendOutput(
                      state,
                      formatDimMessage(`Saved ${channel} bot token in config.`)
                    );
                    appendOutput(state, "");
                  } catch (error) {
                    appendOutput(
                      state,
                      formatErrorMessage(`Setup save failed: ${formatError(error)}`)
                    );
                    appendOutput(state, "");
                  }
                  forceRender();
                })();
                return;
              }

              continue;
            }

            if (action.type === "move-up") {
              const latestSetup = currentState.setup ?? setup;
              currentState.setup = moveSetupSelection(latestSetup, -1);
              continue;
            }
            if (action.type === "move-down") {
              const latestSetup = currentState.setup ?? setup;
              currentState.setup = moveSetupSelection(latestSetup, 1);
              continue;
            }
            if (action.type === "submit") {
              const latestSetup = currentState.setup ?? setup;
              const channel = getSelectedSetupChannel(latestSetup);
              currentState.setup = { ...latestSetup, editingChannel: channel };
              composerRef.current = createComposer(currentState.config.channels[channel].botToken);
              forceRender();
              return;
            }
          }

          forceRender();
          return;
        }

        if (currentState.uiMode === "sessions") {
          if (currentState.sessionList.length === 0) {
            currentState.uiMode = "chat";
            forceRender();
            return;
          }

          for (const action of actions) {
            if (action.type === "cancel") {
              currentState.uiMode = "chat";
              forceRender();
              return;
            }

            if (action.type === "move-up") {
              const total = currentState.sessionList.length;
              currentState.sessionSelectionIndex =
                (currentState.sessionSelectionIndex - 1 + total) % total;
              continue;
            }

            if (action.type === "move-down") {
              const total = currentState.sessionList.length;
              currentState.sessionSelectionIndex = (currentState.sessionSelectionIndex + 1) % total;
              continue;
            }

            if (action.type === "submit") {
              const selected = currentState.sessionList[currentState.sessionSelectionIndex];
              if (selected) {
                void loadSessionIntoState(selected.path);
              } else {
                currentState.uiMode = "chat";
                forceRender();
              }
              return;
            }
          }

          forceRender();
          return;
        }

        if (currentState.uiMode === "model-manager") {
          const modelManager = currentState.modelManager;
          if (!modelManager) {
            currentState.uiMode = "chat";
            forceRender();
            return;
          }

          for (const action of actions) {
            if (action.type === "cancel") {
              currentState.uiMode = "chat";
              forceRender();
              return;
            }

            if (!currentState.modelManager) {
              continue;
            }

            if (action.type === "insert") {
              if (action.text.toLowerCase() === "t" && composer.getText().trim().length === 0) {
                if (!currentState.downloader) {
                  const specs = getSystemSpecs();
                  currentState.downloader = createDownloaderState(specs);
                }
                currentState.uiMode = "downloader";
                composerRef.current = createComposer(currentState.downloader.searchQuery);
                forceRender();
                scheduleDownloaderSearch(currentState.downloader.searchQuery, true);
                return;
              }
              applyInputAction(composer, action);
              syncModelManagerSearchFromComposer();
              continue;
            }

            if (
              action.type === "backspace" ||
              action.type === "home" ||
              action.type === "end" ||
              action.type === "move-left" ||
              action.type === "move-right"
            ) {
              applyInputAction(composer, action);
              syncModelManagerSearchFromComposer();
              continue;
            }

            if (action.type === "delete") {
              const selected = getSelectedModel(currentState.modelManager);
              if (!selected) {
                continue;
              }
              currentState.modelManager = setModelManagerLoading(
                currentState.modelManager,
                `Deleting ${selected.name}...`
              );
              forceRender();
              void (async () => {
                const state = stateRef.current;
                if (!state || !state.modelManager) {
                  return;
                }
                try {
                  await deleteLocalModel(selected);
                  state.modelManager = removeModelById(state.modelManager, selected.id);
                  if (state.config.model === selected.id) {
                    state.config.model = "default";
                    await saveConfig(state.config);
                  }
                  void refreshModelAutocomplete();
                } catch (error) {
                  state.modelManager = setModelManagerError(
                    state.modelManager,
                    `Delete failed: ${formatError(error)}`
                  );
                }
                forceRender();
              })();
              return;
            }

            if (currentState.modelManager.loading) {
              continue;
            }

            if (action.type === "move-up") {
              currentState.modelManager = moveModelManagerSelection(
                currentState.modelManager,
                -1,
                11
              );
              continue;
            }

            if (action.type === "move-down") {
              currentState.modelManager = moveModelManagerSelection(
                currentState.modelManager,
                1,
                11
              );
              continue;
            }

            if (action.type === "submit") {
              const selected = getSelectedModel(currentState.modelManager);
              if (!selected) {
                continue;
              }
              currentState.uiMode = "chat";
              composerRef.current = createComposer();
              forceRender();
              void (async () => {
                const state = stateRef.current;
                if (!state) {
                  return;
                }

                state.config.backend = "llamacpp";
                state.config.model = selected.id;

                try {
                  await saveConfig(state.config);
                  pruneModelSwitchStatusArtifacts(state);
                  await preloadConfiguredModel(true);
                } catch (error) {
                  appendOutput(
                    state,
                    formatErrorMessage(`Model preload failed: ${formatError(error)}`)
                  );
                  appendOutput(state, "");
                }
                forceRender();
              })();
              return;
            }
          }

          forceRender();
          return;
        }

        if (currentState.uiMode === "downloader") {
          const downloader = currentState.downloader;
          if (!downloader) {
            currentState.uiMode = "chat";
            forceRender();
            return;
          }

          for (const action of actions) {
            if (action.type === "cancel") {
              if (currentState.downloader?.phase === "downloading") {
                if (currentState.downloader.cancelConfirmOpen) {
                  currentState.downloader = closeCancelConfirm(currentState.downloader);
                } else {
                  currentState.downloader = openCancelConfirm(currentState.downloader);
                }
                forceRender();
                return;
              }
              if (currentState.downloader?.view === "files") {
                currentState.downloader = closeFileView(currentState.downloader);
              } else {
                currentState.uiMode = "chat";
                if (downloaderSearchTimerRef.current) {
                  clearTimeout(downloaderSearchTimerRef.current);
                  downloaderSearchTimerRef.current = null;
                }
                downloaderPendingQueryRef.current = null;
              }
              forceRender();
              return;
            }

            if (!currentState.downloader) {
              continue;
            }

            if (
              currentState.downloader.phase === "downloading" &&
              currentState.downloader.cancelConfirmOpen
            ) {
              if (action.type === "submit") {
                downloaderAbortControllerRef.current?.abort();
                downloaderAbortControllerRef.current = null;
                currentState.downloader = finishDownload(currentState.downloader);
                downloaderProgressDirtyRef.current = false;
                downloaderProgressBufferRef.current = null;
                appendOutput(currentState, formatDimMessage("Download canceled."));
                appendOutput(currentState, "");
                forceRender();
                return;
              }
              continue;
            }

            if (currentState.downloader.view === "models") {
              if (
                action.type === "insert" ||
                action.type === "backspace" ||
                action.type === "delete" ||
                action.type === "home" ||
                action.type === "end"
              ) {
                applyInputAction(composer, action);
                syncDownloaderSearchFromComposer(true);
                continue;
              }

              if (currentState.downloader.loading) {
                continue;
              }

              if (action.type === "move-left") {
                currentState.downloader = cycleTab(currentState.downloader, -1);
                const query = currentState.downloader.searchQuery;
                const normalizedQuery = normalizeDownloaderQuery(query);
                if (normalizedQuery === null) {
                  forceRender();
                  return;
                }
                const cached = getCachedModels(
                  currentState.downloader,
                  currentState.downloader.tab,
                  normalizedQuery
                );
                if (cached) {
                  currentState.downloader = setModels(currentState.downloader, cached);
                  forceRender();
                  void preloadDownloaderTabs(normalizedQuery, currentState.downloader.tab);
                  return;
                }
                forceRender();
                void loadDownloaderModels(currentState.downloader.tab, normalizedQuery, {
                  showLoading: true,
                  useCache: false
                });
                return;
              }
              if (action.type === "move-right") {
                currentState.downloader = cycleTab(currentState.downloader, 1);
                const query = currentState.downloader.searchQuery;
                const normalizedQuery = normalizeDownloaderQuery(query);
                if (normalizedQuery === null) {
                  forceRender();
                  return;
                }
                const cached = getCachedModels(
                  currentState.downloader,
                  currentState.downloader.tab,
                  normalizedQuery
                );
                if (cached) {
                  currentState.downloader = setModels(currentState.downloader, cached);
                  forceRender();
                  void preloadDownloaderTabs(normalizedQuery, currentState.downloader.tab);
                  return;
                }
                forceRender();
                void loadDownloaderModels(currentState.downloader.tab, normalizedQuery, {
                  showLoading: true,
                  useCache: false
                });
                return;
              }
              if (action.type === "move-up") {
                currentState.downloader = moveModelSelection(currentState.downloader, -1, 9);
                continue;
              }
              if (action.type === "move-down") {
                currentState.downloader = moveModelSelection(currentState.downloader, 1, 9);
                continue;
              }
              if (action.type === "submit") {
                const selected =
                  currentState.downloader.models[currentState.downloader.selectedModelIndex];
                if (selected) {
                  void loadDownloaderFiles(selected.id);
                }
                return;
              }
            } else {
              if (currentState.downloader.loading) {
                continue;
              }
              if (action.type === "move-up") {
                currentState.downloader = moveFileSelection(currentState.downloader, -1, 9);
                continue;
              }
              if (action.type === "move-down") {
                currentState.downloader = moveFileSelection(currentState.downloader, 1, 9);
                continue;
              }
              if (action.type === "submit") {
                void downloadFromDownloaderSelection();
                return;
              }
            }
          }

          forceRender();
          return;
        }

        composer.setInteriorWidth(Math.max(0, dimensionsRef.current.columns - 2));

        let shouldRender = false;
        const computeCurrentScrollCap = (): number => {
          const promptLayout = composer.getLayout();
          const statusText = buildPromptStatusText(currentState);
          const titleLines = renderTitleBox(
            buildTitleBoxOptions(currentState, version, dimensionsRef.current.columns)
          );
          const promptLines = buildPromptRenderLines(
            dimensionsRef.current.columns,
            statusText,
            promptLayout,
            true
          );
          const autocompleteOverlay = buildAutocompleteOverlayLines(composer, registryRef.current);
          const busyLine =
            currentState.busy && busySpinnerRef.current ? busySpinnerRef.current.render() : "";
          const visibleOutputLines = composeOutputLines({
            outputLines: currentState.outputLines,
            autocompleteOverlay,
            busyLine
          });
          return computeTitleVisibleScrollCap(
            dimensionsRef.current.rows,
            titleLines,
            visibleOutputLines,
            promptLines
          );
        };

        for (const action of actions) {
          if (action.type === "cancel") {
            finalizeAndExit("input-cancel");
            return;
          }

          if (action.type === "scroll-page-up") {
            const pageSize = Math.max(1, dimensionsRef.current.rows - 6);
            shiftOutputScrollOffsetWithCap(currentState, pageSize, computeCurrentScrollCap());
            shouldRender = true;
            continue;
          }

          if (action.type === "scroll-page-down") {
            const pageSize = Math.max(1, dimensionsRef.current.rows - 6);
            shiftOutputScrollOffsetWithCap(currentState, -pageSize, computeCurrentScrollCap());
            shouldRender = true;
            continue;
          }

          if (action.type === "scroll-line-up") {
            shiftOutputScrollOffsetWithCap(
              currentState,
              MOUSE_SCROLL_LINE_STEP,
              computeCurrentScrollCap()
            );
            shouldRender = true;
            continue;
          }

          if (action.type === "scroll-line-down") {
            shiftOutputScrollOffsetWithCap(
              currentState,
              -MOUSE_SCROLL_LINE_STEP,
              computeCurrentScrollCap()
            );
            shouldRender = true;
            continue;
          }

          if (currentState.busy) {
            continue;
          }

          const menuState = composer.getAutocompleteMenuState();
          if (menuState) {
            if (action.type === "move-up") {
              composer.moveAutocompleteSelection(-1);
              shouldRender = true;
              continue;
            }
            if (action.type === "move-down") {
              composer.moveAutocompleteSelection(1);
              shouldRender = true;
              continue;
            }
            if (action.type === "tab") {
              composer.acceptAutocompleteSelection();
              shouldRender = true;
              continue;
            }
            if (action.type === "submit") {
              if (shouldConsumeSubmitForAutocomplete(menuState)) {
                composer.acceptAutocompleteSelection();
                shouldRender = true;
                continue;
              }
            }
          }

          const event = applyInputAction(composer, action);
          if (!event) {
            shouldRender = true;
            continue;
          }

          if (event.type === "none") {
            shouldRender = true;
            continue;
          }

          dispatchComposerEvent(event);
          return;
        }

        if (shouldRender) {
          forceRender();
        }
      };

      stdin.on("data", onData);
      return () => {
        stdin.off("data", onData);
      };
    }, [
      createComposer,
      dispatchComposerEvent,
      downloadFromDownloaderSelection,
      finalizeAndExit,
      forceRender,
      loadSessionIntoState,
      loadDownloaderFiles,
      loadDownloaderModels,
      normalizeDownloaderQuery,
      preloadDownloaderTabs,
      refreshModelAutocomplete,
      resolvePendingConfirmation,
      syncModelManagerSearchFromComposer,
      syncDownloaderSearchFromComposer,
      getVtSession,
      stdin
    ]);

    let titleNodes: React.ReactNode[] = [];
    let outputNodes: React.ReactNode[] = [];
    let promptNodes: React.ReactNode[] = [];

    const fullLines = buildRuntimeRenderLines(state, dimensions, true);

    const visible = computeVisibleLayoutSlices(
      dimensions.rows,
      fullLines.titleLines,
      fullLines.outputLines,
      fullLines.promptLines,
      state.outputScrollOffset
    );

    titleNodes = visible.titleLines.map((line, index) =>
      React.createElement(Text, { key: `title-${index}` }, line.length > 0 ? line : " ")
    );

    outputNodes = visible.outputLines.map((line, index) =>
      React.createElement(Text, { key: `out-${index}` }, line.length > 0 ? line : " ")
    );

    promptNodes = visible.promptLines.map((line, index) =>
      React.createElement(Text, { key: `prompt-${index}` }, line)
    );

    return React.createElement(
      Box,
      { flexDirection: "column" },
      ...titleNodes,
      ...outputNodes,
      ...promptNodes
    );
  };
}
