import { relative, resolve } from "node:path";

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

function normalizeBase(base: string): string {
  return resolve(base);
}

export function resolveToolPath(path: string, workingZone: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return normalizeBase(workingZone);
  }
  return resolve(normalizeBase(workingZone), trimmed);
}

export function isWithinWorkingZone(path: string, workingZone: string): boolean {
  const absolutePath = resolve(path);
  const absoluteZone = normalizeBase(workingZone);
  const rel = relative(absoluteZone, absolutePath);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !rel.startsWith("../"));
}

export interface ToolRisk {
  destructive: boolean;
  outOfZone: boolean;
  requiresConfirmation: boolean;
}

export function assessCommandRisk(command: string, cwd: string, workingZone: string): ToolRisk {
  const destructive = DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
  const resolvedCwd = resolveToolPath(cwd, workingZone);
  const outOfZone = !isWithinWorkingZone(resolvedCwd, workingZone);
  return {
    destructive,
    outOfZone,
    requiresConfirmation: destructive || outOfZone
  };
}

export function assessPathRisk(path: string, workingZone: string): ToolRisk {
  const resolved = resolveToolPath(path, workingZone);
  const outOfZone = !isWithinWorkingZone(resolved, workingZone);
  return {
    destructive: false,
    outOfZone,
    requiresConfirmation: outOfZone
  };
}
