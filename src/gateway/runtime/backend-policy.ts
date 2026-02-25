import type { Backend } from "#types/app-types";

export const DEFAULT_GATEWAY_BACKEND = "llamacpp";
export const GATEWAY_BACKEND_ENV_VAR = "YIPS_GATEWAY_BACKEND";

export function resolveGatewayBackendFromEnv(rawValue: string | undefined): Backend {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return DEFAULT_GATEWAY_BACKEND;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "llamacpp") {
    return "llamacpp";
  }

  throw new Error(
    `Unsupported ${GATEWAY_BACKEND_ENV_VAR} value '${trimmed}'. ` +
      "Gateway headless mode currently supports backend 'llamacpp' only."
  );
}
