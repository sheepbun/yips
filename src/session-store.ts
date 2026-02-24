import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { ChatMessage } from "./types";

const SESSION_DIR = join(homedir(), ".yips", "memory");

export interface SessionListItem {
  path: string;
  sessionName: string;
  timestamp: Date;
  display: string;
}

export interface LoadedSession {
  history: ChatMessage[];
  sessionName: string;
  path: string;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toSessionTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    "-",
    pad2(now.getMonth() + 1),
    "-",
    pad2(now.getDate()),
    "_",
    pad2(now.getHours()),
    "-",
    pad2(now.getMinutes()),
    "-",
    pad2(now.getSeconds())
  ].join("");
}

function toDisplayTitle(sessionName: string): string {
  const words = sessionName
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "Session";
  }
  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function parseFileStem(path: string): { timestamp: Date; sessionName: string } {
  const stem = basename(path, ".md");
  const parts = stem.split("_", 3);
  if (parts.length >= 3) {
    const datePart = parts[0] ?? "";
    const timePart = parts[1] ?? "";
    const sessionName = stem.slice(`${datePart}_${timePart}_`.length);

    if (datePart.includes("-")) {
      const dt = new Date(`${datePart}T${timePart.replace(/-/g, ":")}`);
      if (!Number.isNaN(dt.valueOf())) {
        return { timestamp: dt, sessionName };
      }
    } else if (datePart.length === 8 && timePart.length >= 6) {
      const year = Number.parseInt(datePart.slice(0, 4), 10);
      const month = Number.parseInt(datePart.slice(4, 6), 10);
      const day = Number.parseInt(datePart.slice(6, 8), 10);
      const hour = Number.parseInt(timePart.slice(0, 2), 10);
      const minute = Number.parseInt(timePart.slice(2, 4), 10);
      const second = Number.parseInt(timePart.slice(4, 6), 10);
      const dt = new Date(year, month - 1, day, hour, minute, second);
      if (!Number.isNaN(dt.valueOf())) {
        return { timestamp: dt, sessionName };
      }
    }
  }

  return {
    timestamp: new Date(0),
    sessionName: stem
  };
}

function formatDisplayTimestamp(timestamp: Date): string {
  const year = timestamp.getFullYear();
  const month = timestamp.getMonth() + 1;
  const day = timestamp.getDate();
  const hours = timestamp.getHours();
  const minutes = pad2(timestamp.getMinutes());
  const amPm = hours < 12 ? "AM" : "PM";
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${year}-${month}-${day} @ ${displayHour.toString().padStart(2, " ")}:${minutes} ${amPm}`;
}

function toDisplay(sessionName: string, timestamp: Date): string {
  return `${formatDisplayTimestamp(timestamp)}: ${toDisplayTitle(sessionName)}`;
}

function parseConversation(content: string): ChatMessage[] {
  const marker = "## Conversation";
  const markerIndex = content.indexOf(marker);
  const section =
    markerIndex >= 0
      ? content.slice(markerIndex + marker.length).split("\n---")[0] ?? ""
      : content;

  const history: ChatMessage[] = [];
  const lines = section.split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const roleMatch = line.match(/^\*\*([^*]+)\*\*:\s*(.*)$/u);
    if (roleMatch) {
      const roleName = (roleMatch[1] ?? "").trim();
      const text = roleMatch[2] ?? "";
      if (roleName.toLowerCase() === "yips") {
        history.push({ role: "assistant", content: text });
      } else {
        history.push({ role: "user", content: text });
      }
      continue;
    }

    const systemMatch = line.match(/^\*\[System:\s*(.*)\]\*$/u);
    if (systemMatch) {
      history.push({ role: "system", content: systemMatch[1] ?? "" });
      continue;
    }

    if (line.trim().length === 0) {
      continue;
    }

    const last = history[history.length - 1];
    if (last) {
      last.content = `${last.content}\n${line}`.trimEnd();
    }
  }
  return history;
}

export function slugifySessionNameFromMessage(message: string): string {
  const base = message.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");
  if (base.length === 0) {
    return "session";
  }
  const slug = base.replace(/\s+/g, "_").slice(0, 50).replace(/_+$/g, "");
  return slug.length > 0 ? slug : "session";
}

export function getFirstUserMessage(history: readonly ChatMessage[]): string | null {
  for (const message of history) {
    if (message.role === "user") {
      const trimmed = message.content.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

export async function createSessionFileFromHistory(
  history: readonly ChatMessage[],
  now: Date = new Date()
): Promise<{ path: string; sessionName: string }> {
  await mkdir(SESSION_DIR, { recursive: true });
  const firstUserMessage = getFirstUserMessage(history) ?? "";
  const sessionName = slugifySessionNameFromMessage(firstUserMessage);
  const path = join(SESSION_DIR, `${toSessionTimestamp(now)}_${sessionName}.md`);
  return { path, sessionName };
}

export async function writeSessionFile(options: {
  path: string;
  username: string;
  history: readonly ChatMessage[];
  now?: Date;
}): Promise<void> {
  const now = options.now ?? new Date();
  const lines: string[] = [];

  for (const message of options.history) {
    if (message.role === "user") {
      lines.push(`**${options.username}**: ${message.content}`);
      continue;
    }
    if (message.role === "assistant") {
      lines.push(`**Yips**: ${message.content}`);
      continue;
    }
    lines.push(`*[System: ${message.content}]*`);
  }

  const body = [
    "# Session Memory",
    "",
    `**Created**: ${now.toISOString()}`,
    "**Type**: Ongoing Session",
    "",
    "## Conversation",
    "",
    ...lines,
    "",
    "---",
    `*Last updated: ${now.toISOString()}*`,
    ""
  ].join("\n");

  await writeFile(options.path, body, "utf8");
}

export async function listSessions(limit?: number): Promise<SessionListItem[]> {
  try {
    const entries = await readdir(SESSION_DIR, { withFileTypes: true });
    const sessionItems = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => {
        const path = join(SESSION_DIR, entry.name);
        const parsed = parseFileStem(path);
        return {
          path,
          sessionName: parsed.sessionName,
          timestamp: parsed.timestamp,
          display: toDisplay(parsed.sessionName, parsed.timestamp)
        };
      })
      .sort((a, b) => b.timestamp.valueOf() - a.timestamp.valueOf());

    return typeof limit === "number" && limit > 0 ? sessionItems.slice(0, limit) : sessionItems;
  } catch {
    return [];
  }
}

export async function loadSession(path: string): Promise<LoadedSession> {
  const content = await readFile(path, "utf8");
  const parsed = parseFileStem(path);
  return {
    history: parseConversation(content),
    sessionName: parsed.sessionName,
    path
  };
}
