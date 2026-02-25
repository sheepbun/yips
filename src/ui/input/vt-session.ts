import { resolve } from "node:path";

import { spawn, type IPty } from "node-pty";

function escapeForSingleQuotedShell(value: string): string {
  return value.replace(/'/gu, "'\\''");
}

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  let output = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] === esc && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        const isFinalByte = code >= 0x40 && code <= 0x7e;
        index += 1;
        if (isFinalByte) {
          break;
        }
      }
      continue;
    }

    output += value[index] ?? "";
    index += 1;
  }

  return output;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
}

export interface RunCommandResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export type VtDataListener = (chunk: string) => void;

export class VirtualTerminalSession {
  private pty: IPty | null = null;
  private listeners = new Set<VtDataListener>();
  private lines: string[] = [];
  private currentLine = "";

  ensureStarted(cols = 100, rows = 30): void {
    if (this.pty) {
      return;
    }

    const shell = process.env["SHELL"]?.trim() || "/bin/bash";
    this.pty = spawn(shell, ["-i"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: { ...process.env }
    });

    this.pty.onData((chunk) => {
      this.consumeDisplayChunk(chunk);
      for (const listener of this.listeners) {
        listener(chunk);
      }
    });
  }

  onData(listener: VtDataListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  resize(cols: number, rows: number): void {
    this.ensureStarted(cols, rows);
    this.pty?.resize(Math.max(20, cols), Math.max(8, rows));
  }

  write(data: string): void {
    this.ensureStarted();
    this.pty?.write(data);
  }

  getDisplayLines(limit = 200): string[] {
    const all = this.currentLine.length > 0 ? [...this.lines, this.currentLine] : [...this.lines];
    return all.slice(-Math.max(1, limit));
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<RunCommandResult> {
    this.ensureStarted();

    const cwd = resolve(options.cwd);
    const commandTimeoutMs = Math.max(1_000, Math.min(120_000, options.timeoutMs));
    const id = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const startMarker = `__YIPS_START_${id}__`;
    const endPrefix = `__YIPS_END_${id}__:`;

    const wrapped = [
      `printf '%s\\n' '${startMarker}'`,
      `cd '${escapeForSingleQuotedShell(cwd)}' && (${command})`,
      `printf '%s%s\\n' '${endPrefix}' "$?"`
    ].join("; ");

    return await new Promise<RunCommandResult>((resolveResult) => {
      let buffer = "";
      let started = false;
      let settled = false;

      const cleanup = (result: RunCommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        off();
        clearTimeout(timer);
        resolveResult(result);
      };

      const endPattern = new RegExp(`${escapeRegExp(endPrefix)}(\\d+)`, "u");

      const off = this.onData((chunk) => {
        if (settled) {
          return;
        }

        buffer += chunk;

        if (!started) {
          const startIndex = buffer.indexOf(startMarker);
          if (startIndex < 0) {
            return;
          }
          started = true;
          buffer = buffer.slice(startIndex + startMarker.length);
        }

        const endMatch = buffer.match(endPattern);
        if (!endMatch || typeof endMatch.index !== "number") {
          return;
        }

        const outputRaw = buffer.slice(0, endMatch.index);
        const output = stripAnsi(outputRaw).replace(/^\s+|\s+$/gu, "");
        const exitCode = Number.parseInt(endMatch[1] ?? "1", 10);
        cleanup({
          exitCode: Number.isFinite(exitCode) ? exitCode : 1,
          output,
          timedOut: false
        });
      });

      const timer = setTimeout(() => {
        cleanup({
          exitCode: 124,
          output: "Command timed out.",
          timedOut: true
        });
      }, commandTimeoutMs);

      this.pty?.write(`${wrapped}\r`);
    });
  }

  dispose(): void {
    this.listeners.clear();
    this.pty?.kill();
    this.pty = null;
    this.lines = [];
    this.currentLine = "";
  }

  private consumeDisplayChunk(chunk: string): void {
    const plain = stripAnsi(chunk).replace(/\r\n/gu, "\n");
    for (const char of Array.from(plain)) {
      if (char === "\n") {
        this.lines.push(this.currentLine);
        this.currentLine = "";
        continue;
      }
      if (char === "\r") {
        this.currentLine = "";
        continue;
      }
      if (char === "\b") {
        this.currentLine = this.currentLine.slice(0, -1);
        continue;
      }
      this.currentLine += char;
    }

    if (this.lines.length > 1000) {
      this.lines = this.lines.slice(-1000);
    }
  }
}
