import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assessActionRisk,
  assessCommandRisk,
  assessPathRisk,
  isWithinSessionRoot
} from "#agent/tools/action-risk-policy";

describe("action-risk-policy", () => {
  it("classifies destructive commands", () => {
    const risk = assessCommandRisk("rm -rf .", ".", process.cwd());
    expect(risk.riskLevel).toBe("confirm");
    expect(risk.reasons).toContain("destructive");
  });

  it("classifies out-of-zone paths", () => {
    const root = process.cwd();
    const outside = resolve(root, "..", "..", "tmp");
    const risk = assessPathRisk(outside, root);
    expect(risk.riskLevel).toBe("confirm");
    expect(risk.reasons).toContain("outside-working-zone");
  });

  it("denies combined destructive + out-of-zone command", () => {
    const root = process.cwd();
    const risk = assessCommandRisk("rm -rf .", resolve(root, ".."), root);
    expect(risk.riskLevel).toBe("deny");
  });

  it("assesses a tool call directly", () => {
    const risk = assessActionRisk(
      {
        id: "t1",
        name: "preview_write_file",
        arguments: { path: "README.md", content: "x" }
      },
      process.cwd()
    );
    expect(risk.riskLevel).toBe("none");
    expect(isWithinSessionRoot(resolve(process.cwd(), "src"), process.cwd())).toBe(true);
  });

  it("requires confirmation for apply_file_change", () => {
    const risk = assessActionRisk(
      {
        id: "t2",
        name: "apply_file_change",
        arguments: { token: "abc" }
      },
      process.cwd()
    );
    expect(risk.riskLevel).toBe("confirm");
    expect(risk.reasons).toContain("file-mutation");
  });
});
