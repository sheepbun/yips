import { describe, expect, it } from "vitest";

import {
  createSetupState,
  getSelectedSetupChannel,
  moveSetupSelection,
  SETUP_CHANNELS
} from "#ui/setup/setup-state";

describe("setup-state", () => {
  it("starts at first channel", () => {
    const state = createSetupState();
    expect(getSelectedSetupChannel(state)).toBe(SETUP_CHANNELS[0]);
    expect(state.editingChannel).toBeNull();
  });

  it("cycles selection up/down", () => {
    const start = createSetupState();
    const down = moveSetupSelection(start, 1);
    expect(getSelectedSetupChannel(down)).toBe("telegram");

    const wrapped = moveSetupSelection(start, -1);
    expect(getSelectedSetupChannel(wrapped)).toBe("discord");
  });
});
