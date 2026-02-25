import { describe, expect, it } from "vitest";

import { composeChatRequestMessages } from "#ui/tui/start-tui";
import type { ChatMessage } from "#types/app-types";

describe("tui code context composition", () => {
  it("prepends CODE.md system context when present", () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];
    const messages = composeChatRequestMessages(history, "Project context...");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "Project context..." });
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("returns original history when no context is available", () => {
    const history: ChatMessage[] = [{ role: "user", content: "hello" }];
    const messages = composeChatRequestMessages(history, null);
    expect(messages).toEqual(history);
  });
});
