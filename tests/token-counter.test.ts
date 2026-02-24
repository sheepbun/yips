import { describe, expect, it } from "vitest";

import {
  computeAutoMaxTokens,
  estimateConversationTokens,
  formatTitleTokenUsage,
  resolveEffectiveMaxTokens
} from "../src/token-counter";

describe("computeAutoMaxTokens", () => {
  it("computes from RAM minus model size minus reserve", () => {
    const max = computeAutoMaxTokens({
      ramGb: 24,
      modelSizeBytes: 8 * 1024 ** 3
    });
    expect(max).toBe(21000);
  });

  it("clamps to lower bound", () => {
    const max = computeAutoMaxTokens({
      ramGb: 2,
      modelSizeBytes: 0
    });
    expect(max).toBe(4096);
  });

  it("clamps to upper bound", () => {
    const max = computeAutoMaxTokens({
      ramGb: 200,
      modelSizeBytes: 0
    });
    expect(max).toBe(128000);
  });
});

describe("resolveEffectiveMaxTokens", () => {
  it("uses manual max in manual mode", () => {
    expect(resolveEffectiveMaxTokens("manual", 32000, 15000)).toBe(32000);
  });

  it("uses auto max in auto mode", () => {
    expect(resolveEffectiveMaxTokens("auto", 32000, 15000)).toBe(15000);
  });
});

describe("formatTitleTokenUsage", () => {
  it("formats both sides in k-units with one decimal when >= 1000", () => {
    expect(formatTitleTokenUsage(15700, 32200)).toBe("15.7k/32.2k tks");
  });

  it("omits redundant trailing .0", () => {
    expect(formatTitleTokenUsage(0, 32000)).toBe("0/32k tks");
  });
});

describe("estimateConversationTokens", () => {
  it("estimates from message content", () => {
    expect(
      estimateConversationTokens([
        { content: "hello world" },
        { content: "ok" }
      ])
    ).toBe(4);
  });
});
