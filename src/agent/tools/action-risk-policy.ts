import { relative, resolve } from "node:path";

import type { ToolCall } from "#types/app-types";

const DESTRUCTIVE_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\s)rm\s+-rf(\s|$)/u,
  /(^|\s)rm\s+-fr(\s|$)/u,
  /(^|\s)mkfs(\.|\s|$)/u,
  /(^|\s)dd\s+if=/u,
  /(^|\s)reboot(\s|$)/u,
  /(^|\s)shutdown(\s|$)/u,
  /(^|\s)poweroff(\s|$)/u,
  /(^|\s)halt(\s|$)/u
];

export type ActionRiskLevel = "none" | "confirm" | "deny";

export interface ActionRiskAssessment {
  riskLevel: ActionRiskLevel;
  reasons: string[];
  requiresConfirmation: boolean;
  destructive: boolean;
  outOfZone: boolean;
  resolvedPath: string;
}

export function resolveSessionPath(path: string, sessionRoot: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return resolve(sessionRoot);
  }
  return resolve(resolve(sessionRoot), trimmed);
}

export function isWithinSessionRoot(path: string, sessionRoot: string): boolean {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(sessionRoot);
  const rel = relative(absoluteRoot, absolutePath);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !rel.startsWith("../"));
}

function toRiskLevel(destructive: boolean, outOfZone: boolean): ActionRiskLevel {
  if (destructive && outOfZone) {
    return "deny";
  }
  if (destructive || outOfZone) {
    return "confirm";
  }
  return "none";
}

export function assessCommandRisk(
  command: string,
  cwd: string,
  sessionRoot: string
): ActionRiskAssessment {
  const destructive = DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
  const resolvedPath = resolveSessionPath(cwd, sessionRoot);
  const outOfZone = !isWithinSessionRoot(resolvedPath, sessionRoot);
  const reasons: string[] = [];

  if (destructive) {
    reasons.push("destructive");
  }
  if (outOfZone) {
    reasons.push("outside-working-zone");
  }

  const riskLevel = toRiskLevel(destructive, outOfZone);

  return {
    riskLevel,
    reasons,
    requiresConfirmation: riskLevel === "confirm",
    destructive,
    outOfZone,
    resolvedPath
  };
}

export function assessPathRisk(path: string, sessionRoot: string): ActionRiskAssessment {
  const resolvedPath = resolveSessionPath(path, sessionRoot);
  const outOfZone = !isWithinSessionRoot(resolvedPath, sessionRoot);
  const riskLevel = outOfZone ? "confirm" : "none";

  return {
    riskLevel,
    reasons: outOfZone ? ["outside-working-zone"] : [],
    requiresConfirmation: riskLevel === "confirm",
    destructive: false,
    outOfZone,
    resolvedPath
  };
}

export function assessActionRisk(call: ToolCall, sessionRoot: string): ActionRiskAssessment {
  if (call.name === "run_command") {
    const command = typeof call.arguments["command"] === "string" ? call.arguments["command"] : "";
    const cwdArg = typeof call.arguments["cwd"] === "string" ? call.arguments["cwd"] : ".";
    return assessCommandRisk(command, cwdArg, sessionRoot);
  }

  const pathArg = typeof call.arguments["path"] === "string" ? call.arguments["path"] : ".";
  return assessPathRisk(pathArg, sessionRoot);
}
