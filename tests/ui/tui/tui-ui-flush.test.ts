import { describe, expect, it, vi } from "vitest";

import { flushUiRender, yieldToUi } from "#ui/tui/runtime-core";

describe("ui flush helpers", () => {
  it("yieldToUi resolves asynchronously", async () => {
    const events: string[] = [];
    events.push("before");
    const pending = yieldToUi().then(() => {
      events.push("after");
    });
    events.push("sync");

    expect(events).toEqual(["before", "sync"]);
    await pending;
    expect(events).toEqual(["before", "sync", "after"]);
  });

  it("flushUiRender renders immediately and resolves after yielding", async () => {
    const events: string[] = [];
    const render = vi.fn(() => {
      events.push("render");
    });

    const pending = flushUiRender(render).then(() => {
      events.push("resolved");
    });
    events.push("sync");

    expect(render).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["render", "sync"]);
    await pending;
    expect(events).toEqual(["render", "sync", "resolved"]);
  });
});
