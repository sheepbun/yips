import { describe, expect, it } from "vitest";

import {
  formatAssistantMessage,
  formatDimMessage,
  formatErrorMessage,
  formatSuccessMessage,
  formatUserMessage,
  formatWarningMessage
} from "../src/messages";
import { stripMarkup } from "../src/title-box";

describe("formatUserMessage", () => {
  it("prefixes with >>> and applies color", () => {
    const result = formatUserMessage("hello world");
    expect(result).toContain("^[#");
    expect(stripMarkup(result)).toBe(">>> hello world");
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
});

describe("formatErrorMessage", () => {
  it("applies red color markup", () => {
    const result = formatErrorMessage("something went wrong");
    expect(result).toContain("^[#");
    expect(stripMarkup(result)).toBe("something went wrong");
  });
});

describe("formatWarningMessage", () => {
  it("applies yellow color markup", () => {
    const result = formatWarningMessage("caution");
    expect(result).toContain("^[#");
    expect(stripMarkup(result)).toBe("caution");
  });
});

describe("formatSuccessMessage", () => {
  it("applies green color markup", () => {
    const result = formatSuccessMessage("done");
    expect(result).toContain("^[#");
    expect(stripMarkup(result)).toBe("done");
  });
});

describe("formatDimMessage", () => {
  it("applies dim color markup", () => {
    const result = formatDimMessage("subtle");
    expect(result).toContain("^[#");
    expect(stripMarkup(result)).toBe("subtle");
  });
});
