import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findHookScript, HOOKS_DIR_ENV, listHooks, runHook } from "../src/hook-runner";

const originalHooksDir = process.env[HOOKS_DIR_ENV];

afterEach(() => {
  if (originalHooksDir === undefined) {
    delete process.env[HOOKS_DIR_ENV];
  } else {
    process.env[HOOKS_DIR_ENV] = originalHooksDir;
  }
});

async function makeExecutableScript(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function makeNonExecutableScript(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o644);
  return path;
}

describe("hook-runner / findHookScript", () => {
  it("finds an extensionless executable hook script", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-find-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const expected = await makeExecutableScript(root, "on-file-write", "#!/bin/sh\necho ok");
      const found = await findHookScript("on-file-write");
      expect(found).toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds a .sh executable hook script", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-find-sh-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const expected = await makeExecutableScript(root, "on-session-start.sh", "#!/bin/sh\necho ok");
      const found = await findHookScript("on-session-start");
      expect(found).toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when no hook script exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-find-none-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const found = await findHookScript("pre-commit");
      expect(found).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when script exists but is not executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-find-noexec-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      await makeNonExecutableScript(root, "on-file-read", "#!/bin/sh\necho ok");
      await makeNonExecutableScript(root, "on-file-read.sh", "#!/bin/sh\necho ok");
      const found = await findHookScript("on-file-read");
      expect(found).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when hooks directory does not exist", async () => {
    process.env[HOOKS_DIR_ENV] = "/tmp/yips-hooks-does-not-exist-xyz";
    const found = await findHookScript("on-session-end");
    expect(found).toBeNull();
  });
});

describe("hook-runner / runHook", () => {
  it("returns null when no hook is registered", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-run-none-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const result = await runHook("pre-commit");
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns exitCode 0 and stdout for a successful hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-run-ok-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      await makeExecutableScript(root, "on-session-start.sh", "#!/bin/sh\necho 'session started'");
      const result = await runHook("on-session-start");
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toContain("session started");
      expect(result?.stderr).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures non-zero exit code and stderr from a failing hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-run-fail-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      await makeExecutableScript(
        root,
        "on-file-write.sh",
        "#!/bin/sh\necho 'lint error' >&2\nexit 1"
      );
      const result = await runHook("on-file-write", ["/tmp/foo.ts"]);
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(1);
      expect(result?.stderr).toContain("lint error");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes arguments to the hook script", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-run-args-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      await makeExecutableScript(root, "on-file-read.sh", "#!/bin/sh\necho \"arg=$1\"");
      const result = await runHook("on-file-read", ["/home/user/src/foo.ts"]);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toContain("arg=/home/user/src/foo.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hook-runner / listHooks", () => {
  it("returns empty array when hooks directory does not exist", async () => {
    process.env[HOOKS_DIR_ENV] = "/tmp/yips-hooks-list-nodir-xyz";
    const hooks = await listHooks();
    expect(hooks).toEqual([]);
  });

  it("returns empty array for an empty hooks directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-list-empty-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const hooks = await listHooks();
      expect(hooks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns discovered executable hook scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-list-found-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      const writePath = await makeExecutableScript(
        root,
        "on-file-write.sh",
        "#!/bin/sh\nprettier --write \"$1\""
      );
      const commitPath = await makeExecutableScript(root, "pre-commit", "#!/bin/sh\nnpm test");

      const hooks = await listHooks();
      expect(hooks).toHaveLength(2);
      const events = hooks.map((h) => h.event);
      expect(events).toContain("on-file-write");
      expect(events).toContain("pre-commit");
      const paths = hooks.map((h) => h.path);
      expect(paths).toContain(writePath);
      expect(paths).toContain(commitPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes non-executable scripts and unknown event names", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-hooks-list-filter-"));
    process.env[HOOKS_DIR_ENV] = root;

    try {
      await makeNonExecutableScript(root, "on-file-write.sh", "#!/bin/sh\necho ok");
      await makeExecutableScript(root, "unknown-event.sh", "#!/bin/sh\necho ok");
      await mkdir(join(root, "on-session-start")); // directory, not file

      const hooks = await listHooks();
      expect(hooks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
