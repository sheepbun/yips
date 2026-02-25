import { describe, expect, it } from "vitest";

import { renderHistoryLines } from "#ui/tui/start-tui";
import { stripMarkup } from "#ui/title-box";
import type { ChatMessage } from "#types/app-types";

describe("renderHistoryLines", () => {
  it("keeps user message directly adjacent to assistant response", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" }
    ];

    const rendered = renderHistoryLines(history);
    const plain = rendered.lines.map((line) => stripMarkup(line));

    expect(rendered.userCount).toBe(1);
    expect(plain[0]).toBe(">>> hello");
    expect(plain[1]).toMatch(/^\[\d{1,2}:\d{2} [AP]M\] Yips: hi there$/);
    expect(plain[2]).toBe("");
  });

  it("adds spacing only after assistant messages", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" }
    ];

    const rendered = renderHistoryLines(history);
    const plain = rendered.lines.map((line) => stripMarkup(line));
    expect(plain[0]).toBe(">>> one");
    expect(plain[1]).toMatch(/^\[\d{1,2}:\d{2} [AP]M\] Yips: first$/);
    expect(plain[2]).toBe("");
    expect(plain[3]).toBe(">>> two");
  });
});
