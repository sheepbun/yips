import { describe, expect, it, vi } from "vitest";

import { generateVersion, getGitInfo, getVersion } from "../src/version";

vi.mock("node:child_process", () => {
  const actual = vi.importActual("node:child_process");
  return {
    ...actual,
    execFile: vi.fn()
  };
});

import { execFile as execFileCb } from "node:child_process";

const mockExecFile = vi.mocked(execFileCb);

function stubExecFile(timestampOut: string, shaOut: string): void {
  mockExecFile.mockImplementation(((
    _cmd: string,
    args: readonly string[] | undefined,
    _opts: unknown,
    cb: unknown
  ) => {
    const callback = cb as (err: Error | null, result: { stdout: string }) => void;
    const firstArg = args?.[0] ?? "";
    if (firstArg === "log") {
      callback(null, { stdout: timestampOut });
    } else {
      callback(null, { stdout: shaOut });
    }
  }) as typeof execFileCb);
}

function stubExecFileError(): void {
  mockExecFile.mockImplementation(((
    _cmd: string,
    _args: readonly string[] | undefined,
    _opts: unknown,
    cb: unknown
  ) => {
    const callback = cb as (err: Error | null, result: { stdout: string }) => void;
    callback(new Error("git not found"), { stdout: "" });
  }) as typeof execFileCb);
}

describe("generateVersion", () => {
  it("formats a date with no zero-padding", () => {
    const date = new Date(2026, 1, 3); // Feb 3, 2026
    expect(generateVersion(date, "a1b2c3d")).toBe("v2026.2.3-a1b2c3d");
  });

  it("formats a date in December correctly", () => {
    const date = new Date(2025, 11, 25); // Dec 25, 2025
    expect(generateVersion(date, "ff00ff1")).toBe("v2025.12.25-ff00ff1");
  });

  it("handles single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(generateVersion(date, "abc1234")).toBe("v2026.1.5-abc1234");
  });
});

describe("getGitInfo", () => {
  it("returns commit date and short SHA on success", async () => {
    // 1740268800 = 2025-02-23T00:00:00Z
    stubExecFile("1740268800\n", "a1b2c3d\n");

    const result = await getGitInfo();
    expect(result).not.toBeNull();
    expect(result?.shortSha).toBe("a1b2c3d");
    expect(result?.commitDate.getFullYear()).toBe(2025);
  });

  it("returns null when git commands fail", async () => {
    stubExecFileError();

    const result = await getGitInfo();
    expect(result).toBeNull();
  });

  it("returns null for non-numeric timestamp", async () => {
    stubExecFile("not-a-number\n", "a1b2c3d\n");

    const result = await getGitInfo();
    expect(result).toBeNull();
  });
});

describe("getVersion", () => {
  it("returns git-derived version on success", async () => {
    stubExecFile("1740268800\n", "a1b2c3d\n");

    const version = await getVersion();
    expect(version).toMatch(/^v\d{4}\.\d{1,2}\.\d{1,2}-a1b2c3d$/);
  });

  it("falls back to 1.0.0 when git fails", async () => {
    stubExecFileError();

    const version = await getVersion();
    expect(version).toBe("1.0.0");
  });
});
