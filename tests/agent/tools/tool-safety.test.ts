import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assessCommandRisk, assessPathRisk, isWithinWorkingZone } from "#agent/tools/tool-safety";

describe("tool-safety", () => {
  it("detects destructive run_command patterns", () => {
    const risk = assessCommandRisk("rm -rf .", ".", process.cwd());
    expect(risk.destructive).toBe(true);
    expect(risk.requiresConfirmation).toBe(true);
  });

  it("detects out-of-zone paths", () => {
    const root = process.cwd();
    const outside = resolve(root, "..", "..", "tmp");
    const risk = assessPathRisk(outside, root);
    expect(risk.outOfZone).toBe(true);
    expect(risk.requiresConfirmation).toBe(true);
  });

  it("accepts in-zone paths", () => {
    const root = process.cwd();
    expect(isWithinWorkingZone(resolve(root, "src"), root)).toBe(true);
  });
});
