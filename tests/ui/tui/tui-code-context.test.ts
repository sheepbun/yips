import { describe, expect, it } from "vitest";

import { composeChatRequestMessages } from "#ui/tui/start-tui";
import type { ChatMessage } from "#types/app-types";

describe("tui code context composition", () => {
  it("prepends protocol + CODE.md system context when present", () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];
    const messages = composeChatRequestMessages(history, "Project context...");

    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Tool protocol:");
    expect(messages[1]).toEqual({ role: "system", content: "Project context..." });
    expect(messages[2]).toEqual({ role: "user", content: "hello" });
  });

  it("prepends protocol system context when CODE.md is unavailable", () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];
    const messages = composeChatRequestMessages(history, null);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Tool protocol:");
    expect(messages[1]).toEqual(history[0]);
  });
});
