import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const CODE_MD_FILENAME = "CODE.md";
const MAX_CODE_MD_CHARS = 24_000;

export interface LoadedCodeContext {
  path: string;
  content: string;
  truncated: boolean;
}

function truncateContent(
  content: string,
  maxChars: number
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, maxChars)}\n\n[CODE.md truncated to ${maxChars} characters]`,
    truncated: true
  };
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function findCodeMdCandidates(startDir: string): string[] {
  const candidates: string[] = [];
  let current = resolve(startDir);

  for (;;) {
    candidates.push(join(current, CODE_MD_FILENAME));
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return candidates;
}

export async function loadCodeContext(
  startDir: string = process.cwd()
): Promise<LoadedCodeContext | null> {
  const candidates = findCodeMdCandidates(startDir);

  for (const candidate of candidates) {
    if (!(await isReadable(candidate))) {
      continue;
    }

    try {
      const raw = await readFile(candidate, "utf8");
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const truncated = truncateContent(trimmed, MAX_CODE_MD_CHARS);
      return {
        path: candidate,
        content: truncated.content,
        truncated: truncated.truncated
      };
    } catch {
      // continue to parent candidate
    }
  }

  return null;
}

export function toCodeContextSystemMessage(context: LoadedCodeContext): string {
  return [`Project context from CODE.md (${context.path}):`, "", context.content].join("\n");
}
