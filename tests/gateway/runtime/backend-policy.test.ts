import { describe, expect, it } from "vitest";

import {
  DEFAULT_GATEWAY_BACKEND,
  resolveGatewayBackendFromEnv
} from "#gateway/runtime/backend-policy";

describe("gateway runtime backend policy", () => {
  it("defaults to llama backend when env is unset", () => {
    expect(resolveGatewayBackendFromEnv(undefined)).toBe(DEFAULT_GATEWAY_BACKEND);
  });

  it("accepts explicit llama backend", () => {
    expect(resolveGatewayBackendFromEnv("llamacpp")).toBe("llamacpp");
    expect(resolveGatewayBackendFromEnv("  llamacpp  ")).toBe("llamacpp");
    expect(resolveGatewayBackendFromEnv("LLAMACPP")).toBe("llamacpp");
  });

  it("rejects unsupported backends", () => {
    expect(() => resolveGatewayBackendFromEnv("claude")).toThrow(
      "Gateway headless mode currently supports backend 'llamacpp' only."
    );
  });
});
