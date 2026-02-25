import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findCodeMdCandidates,
  loadCodeContext,
  toCodeContextSystemMessage
} from "#agent/context/code-context";

describe("code-context", () => {
  it("finds CODE.md candidates from cwd to filesystem root", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-code-context-"));
    const child = join(root, "a", "b");
    await mkdir(child, { recursive: true });

    const candidates = findCodeMdCandidates(child);
    expect(candidates[0]).toBe(join(child, "CODE.md"));
    expect(candidates).toContain(join(root, "CODE.md"));
  });

  it("loads nearest CODE.md from cwd/parents", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-code-context-"));
    const child = join(root, "pkg", "app");
    await mkdir(child, { recursive: true });

    await writeFile(join(root, "CODE.md"), "# root", "utf8");
    await writeFile(join(root, "pkg", "CODE.md"), "# pkg", "utf8");

    const loaded = await loadCodeContext(child);
    expect(loaded).not.toBeNull();
    expect(loaded?.path).toBe(join(root, "pkg", "CODE.md"));
    expect(loaded?.content).toContain("# pkg");
  });

  it("returns null when no CODE.md is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-code-context-"));
    const loaded = await loadCodeContext(root);
    expect(loaded).toBeNull();
  });

  it("builds a system message wrapper", () => {
    const message = toCodeContextSystemMessage({
      path: "/tmp/CODE.md",
      content: "# test",
      truncated: false
    });
    expect(message).toContain("Project context from CODE.md");
    expect(message).toContain("# test");
  });
});
