/** Git-derived date-based versioning in the format vYYYY.M.D-SHORTHASH. */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const EXEC_TIMEOUT_MS = 5000;
const SHORT_SHA_LENGTH = 7;
const FALLBACK_VERSION = "1.0.0";

export interface GitInfo {
  commitDate: Date;
  shortSha: string;
}

export async function getGitInfo(): Promise<GitInfo | null> {
  try {
    const [timestampResult, shaResult] = await Promise.all([
      execFile("git", ["log", "-1", "--format=%ct"], { timeout: EXEC_TIMEOUT_MS }),
      execFile("git", ["rev-parse", `--short=${SHORT_SHA_LENGTH}`, "HEAD"], {
        timeout: EXEC_TIMEOUT_MS
      })
    ]);

    const timestamp = parseInt(timestampResult.stdout.trim(), 10);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    const shortSha = shaResult.stdout.trim();
    if (shortSha.length === 0) {
      return null;
    }

    return { commitDate: new Date(timestamp * 1000), shortSha };
  } catch {
    return null;
  }
}

export function generateVersion(commitDate: Date, shortSha: string): string {
  const year = commitDate.getFullYear();
  const month = commitDate.getMonth() + 1;
  const day = commitDate.getDate();
  return `v${year}.${month}.${day}-${shortSha}`;
}

export async function getVersion(): Promise<string> {
  const info = await getGitInfo();
  if (info === null) {
    return FALLBACK_VERSION;
  }
  return generateVersion(info.commitDate, info.shortSha);
}
