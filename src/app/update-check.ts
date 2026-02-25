import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_PACKAGE_NAME = "yips";
const DEFAULT_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const FALLBACK_VERSION = "0.1.0";
const PACKAGE_JSON_PATH = resolve(__dirname, "../..", "package.json");

export type UpdateCheckStatus = "up-to-date" | "update-available" | "unknown";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  status: UpdateCheckStatus;
  source: "npm-registry";
  error?: string;
}

interface RegistryLatestResponse {
  version?: unknown;
}

export interface UpdateCheckOptions {
  packageName?: string;
  registryBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function normalizeSemverInput(version: string): string {
  return version.trim().replace(/^v/u, "");
}

function parseSemver(version: string): [number, number, number] | null {
  const normalized = normalizeSemverInput(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }
  return [major, minor, patch];
}

function compareSemver(left: string, right: string): number | null {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  if (!leftParsed || !rightParsed) {
    return null;
  }

  const [leftMajor, leftMinor, leftPatch] = leftParsed;
  const [rightMajor, rightMinor, rightPatch] = rightParsed;
  const components: ReadonlyArray<[number, number]> = [
    [leftMajor, rightMajor],
    [leftMinor, rightMinor],
    [leftPatch, rightPatch]
  ];

  for (const [leftPart, rightPart] of components) {
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

export async function getInstalledPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Fallback below.
  }
  return FALLBACK_VERSION;
}

export async function checkForUpdates(
  currentVersion: string,
  options: UpdateCheckOptions = {}
): Promise<UpdateCheckResult> {
  const packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
  const registryBaseUrl = (options.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL).replace(/\/+$/u, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    return {
      currentVersion,
      latestVersion: null,
      status: "unknown",
      source: "npm-registry",
      error: "Fetch API is unavailable in this runtime."
    };
  }

  try {
    const response = await fetchImpl(`${registryBaseUrl}/${encodeURIComponent(packageName)}/latest`);
    if (!response.ok) {
      return {
        currentVersion,
        latestVersion: null,
        status: "unknown",
        source: "npm-registry",
        error: `Registry lookup failed (${response.status} ${response.statusText}).`
      };
    }

    const payload = (await response.json()) as RegistryLatestResponse;
    if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
      return {
        currentVersion,
        latestVersion: null,
        status: "unknown",
        source: "npm-registry",
        error: "Registry response did not include a valid version."
      };
    }

    const latestVersion = payload.version.trim();
    const comparison = compareSemver(currentVersion, latestVersion);

    return {
      currentVersion,
      latestVersion,
      status: comparison === -1 ? "update-available" : "up-to-date",
      source: "npm-registry"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      currentVersion,
      latestVersion: null,
      status: "unknown",
      source: "npm-registry",
      error: message
    };
  }
}
