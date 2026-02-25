import { describe, expect, it } from "vitest";

import type { InputAction } from "#ui/input/input-engine";
import { decideConfirmationAction, routeVtInput } from "#ui/input/tui-input-routing";

describe("decideConfirmationAction", () => {
  it("approves on submit", () => {
    const actions: InputAction[] = [{ type: "submit" }];
    expect(decideConfirmationAction(actions)).toBe("approve");
  });

  it("denies on cancel", () => {
    const actions: InputAction[] = [{ type: "cancel" }];
    expect(decideConfirmationAction(actions)).toBe("deny");
  });

  it("approves for y/yes and denies for n/no", () => {
    expect(decideConfirmationAction([{ type: "insert", text: "y" }])).toBe("approve");
    expect(decideConfirmationAction([{ type: "insert", text: " yes " }])).toBe("approve");
    expect(decideConfirmationAction([{ type: "insert", text: "n" }])).toBe("deny");
    expect(decideConfirmationAction([{ type: "insert", text: " no " }])).toBe("deny");
  });

  it("returns null for unrelated input", () => {
    const actions: InputAction[] = [{ type: "insert", text: "maybe" }];
    expect(decideConfirmationAction(actions)).toBeNull();
  });
});

describe("routeVtInput", () => {
  it("exits vt on Ctrl+Q", () => {
    const result = routeVtInput("\u0011", false);
    expect(result).toEqual({
      exitToChat: true,
      nextEscapePending: false,
      passthrough: null
    });
  });

  it("arms pending escape on first Esc and exits on second Esc", () => {
    const first = routeVtInput("\u001b", false);
    expect(first).toEqual({
      exitToChat: false,
      nextEscapePending: true,
      passthrough: null
    });

    const second = routeVtInput("\u001b", true);
    expect(second).toEqual({
      exitToChat: true,
      nextEscapePending: false,
      passthrough: null
    });
  });

  it("passes through regular vt input and clears pending escape", () => {
    const result = routeVtInput("ls -la\r", true);
    expect(result).toEqual({
      exitToChat: false,
      nextEscapePending: false,
      passthrough: "ls -la\r"
    });
  });
});
