import { describe, expect, it } from "vitest";

import { maskToken } from "#ui/setup/setup-ui";

describe("setup-ui", () => {
  it("masks empty token", () => {
    expect(maskToken("")).toBe("<not set>");
  });

  it("masks short tokens fully", () => {
    expect(maskToken("abcdef")).toBe("******");
  });

  it("masks long token middle", () => {
    expect(maskToken("abcdefghijk")).toBe("abc*****ijk");
  });
});
