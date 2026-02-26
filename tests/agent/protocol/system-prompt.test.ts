import { describe, expect, it } from "vitest";

import { TOOL_PROTOCOL_SYSTEM_PROMPT } from "#agent/protocol/system-prompt";

describe("system-prompt", () => {
  it("documents two-phase file mutation tool flow", () => {
    expect(TOOL_PROTOCOL_SYSTEM_PROMPT).toContain("preview_write_file");
    expect(TOOL_PROTOCOL_SYSTEM_PROMPT).toContain("preview_edit_file");
    expect(TOOL_PROTOCOL_SYSTEM_PROMPT).toContain("apply_file_change");
    expect(TOOL_PROTOCOL_SYSTEM_PROMPT).toContain("Legacy write_file/edit_file");
  });
});
