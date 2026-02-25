import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCommandCatalog } from "#agent/commands/command-catalog";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "yips-command-catalog-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, contents: string): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("loadCommandCatalog", () => {
  it("prefers markdown descriptions for discovered skills", () => {
    const root = createTempRoot();
    writeFile(
      root,
      "commands/skills/HELP/HELP.md",
      ["# HELP", "", "Custom help description from markdown.", "", "Usage text here."].join("\n")
    );

    const help = loadCommandCatalog({ projectRoot: root }).find((command) => command.name === "help");
    expect(help).toBeDefined();
    expect(help?.description).toBe("Custom help description from markdown.");
    expect(help?.kind).toBe("skill");
  });

  it("prefers python docstring descriptions over restored defaults", () => {
    const root = createTempRoot();
    writeFile(
      root,
      "commands/tools/FETCH/FETCH.py",
      [
        '"""',
        "FETCH - fetch helper",
        "Description: Custom fetch description from docstring.",
        '"""',
        "",
        "print('ok')"
      ].join("\n")
    );

    const fetch = loadCommandCatalog({ projectRoot: root }).find(
      (command) => command.name === "fetch"
    );
    expect(fetch).toBeDefined();
    expect(fetch?.description).toBe("Custom fetch description from docstring.");
    expect(fetch?.kind).toBe("tool");
  });

  it("falls back to generic metadata when no command files are present", () => {
    const root = createTempRoot();
    mkdirSync(join(root, "commands", "tools", "FOO"), { recursive: true });

    const foo = loadCommandCatalog({ projectRoot: root }).find((command) => command.name === "foo");
    expect(foo).toBeDefined();
    expect(foo?.description).toBe("Command");
    expect(foo?.kind).toBe("tool");
  });

  it("returns command descriptors in deterministic sorted order", () => {
    const root = createTempRoot();
    mkdirSync(join(root, "commands", "tools", "ZZZ"), { recursive: true });
    mkdirSync(join(root, "commands", "tools", "AAA"), { recursive: true });

    const names = loadCommandCatalog({ projectRoot: root }).map((command) => command.name);
    const sorted = [...names].sort((left, right) => left.localeCompare(right));

    expect(names).toEqual(sorted);
  });
});
