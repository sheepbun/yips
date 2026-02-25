import { describe, expect, it } from "vitest";

import {
  formatActionCallBox,
  formatActionResultBox,
  formatAssistantMessage,
  formatDimMessage,
  formatErrorMessage,
  formatSuccessMessage,
  formatUserMessage,
  formatWarningMessage
} from "#ui/messages";
import { stripMarkup } from "#ui/title-box";

describe("formatUserMessage", () => {
  it("prefixes with >>> and applies color", () => {
    const result = formatUserMessage("hello world");
    expect(result).toContain("\u001b[");
    expect(stripMarkup(result)).toBe(">>> hello world");
  });

  it("keeps multiline user output pink on continuation lines", () => {
    const result = formatUserMessage("first line\nsecond line");
    const plain = stripMarkup(result);

    expect(plain).toBe(">>> first line\nsecond line");
    expect(result).toContain("\n\u001b[38;2;255;204;255msecond line");
  });
});

describe("formatAssistantMessage", () => {
  it("includes timestamp, Yips label, and message text", () => {
    const time = new Date(2026, 1, 22, 13, 23);
    const result = formatAssistantMessage("Hello!", time);
    const plain = stripMarkup(result);
    expect(plain).toBe("[1:23 PM] Yips: Hello!");
  });

  it("indents multiline assistant output after the prefix", () => {
    const time = new Date(2026, 1, 22, 13, 23);
    const result = formatAssistantMessage("First line\nSecond line", time);
    const plain = stripMarkup(result);
    expect(plain).toBe("[1:23 PM] Yips: First line\n                Second line");
  });

  it("uses current time when no timestamp provided", () => {
    const result = formatAssistantMessage("test");
    const plain = stripMarkup(result);
    expect(plain).toMatch(/\[\d{1,2}:\d{2} [AP]M\]/);
  });

  it("uses title-box light blue for timestamp and colon", () => {
    const time = new Date(2026, 1, 22, 13, 23);
    const result = formatAssistantMessage("Hello!", time);
    expect(result).toContain("\u001b[38;2;137;207;240m[1:23 PM]\u001b[39m");
    expect(result).toContain("\u001b[38;2;137;207;240m:\u001b[39m");
  });
});

describe("formatErrorMessage", () => {
  it("applies red ANSI color", () => {
    const result = formatErrorMessage("something went wrong");
    expect(result).toContain("\u001b[");
    expect(stripMarkup(result)).toBe("something went wrong");
  });
});

describe("formatWarningMessage", () => {
  it("applies yellow ANSI color", () => {
    const result = formatWarningMessage("caution");
    expect(result).toContain("\u001b[");
    expect(stripMarkup(result)).toBe("caution");
  });
});

describe("formatSuccessMessage", () => {
  it("applies green ANSI color", () => {
    const result = formatSuccessMessage("done");
    expect(result).toContain("\u001b[");
    expect(stripMarkup(result)).toBe("done");
  });
});

describe("formatDimMessage", () => {
  it("applies dim ANSI color", () => {
    const result = formatDimMessage("subtle");
    expect(result).toContain("\u001b[");
    expect(stripMarkup(result)).toBe("subtle");
  });
});

describe("formatActionCallBox", () => {
  it("renders a bordered call box with id/name/preview", () => {
    const result = formatActionCallBox({
      type: "tool",
      id: "t1",
      name: "read_file",
      preview: "README.md"
    });
    const plain = stripMarkup(result);
    expect(plain).toContain("Tool Call");
    expect(plain).toContain("id: t1");
    expect(plain).toContain("name:");
    expect(plain).toContain("read_file");
    expect(plain).toContain("preview: README.md");
  });
});

describe("formatActionResultBox", () => {
  it("renders compact mode with status and preview", () => {
    const result = formatActionResultBox({
      type: "skill",
      id: "s1",
      name: "search",
      status: "ok",
      output: "Found 10 results\nMore detail"
    });
    const plain = stripMarkup(result);
    expect(plain).toContain("Skill Result");
    expect(plain).toContain("id: s1");
    expect(plain).toContain("status: ok");
    expect(plain).toContain("preview: Found 10 results");
  });

  it("renders verbose mode with output lines and metadata", () => {
    const result = formatActionResultBox(
      {
        type: "subagent",
        id: "a1",
        name: "summarize docs",
        status: "error",
        output: "line one\nline two",
        metadata: { rounds: 2 }
      },
      { verbose: true }
    );
    const plain = stripMarkup(result);
    expect(plain).toContain("Subagent Result");
    expect(plain).toContain("status: error");
    expect(plain).toContain("out: line one");
    expect(plain).toContain("meta: {\"rounds\":2}");
  });
});
