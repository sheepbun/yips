import type { InputAction } from "./input-engine";

export type ConfirmationDecision = "approve" | "deny" | null;

export interface VtRoutingResult {
  exitToChat: boolean;
  nextEscapePending: boolean;
  passthrough: string | null;
}

export function decideConfirmationAction(actions: readonly InputAction[]): ConfirmationDecision {
  for (const action of actions) {
    if (action.type === "cancel") {
      return "deny";
    }
    if (action.type === "submit") {
      return "approve";
    }
    if (action.type === "insert") {
      const normalized = action.text.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") {
        return "approve";
      }
      if (normalized === "n" || normalized === "no") {
        return "deny";
      }
    }
  }

  return null;
}

export function routeVtInput(
  sequence: string,
  escapePending: boolean
): VtRoutingResult {
  const bytes = Buffer.from(sequence, "latin1");
  if (bytes.includes(0x11)) {
    return {
      exitToChat: true,
      nextEscapePending: false,
      passthrough: null
    };
  }

  if (sequence === "\u001b") {
    if (escapePending) {
      return {
        exitToChat: true,
        nextEscapePending: false,
        passthrough: null
      };
    }
    return {
      exitToChat: false,
      nextEscapePending: true,
      passthrough: null
    };
  }

  return {
    exitToChat: false,
    nextEscapePending: false,
    passthrough: sequence
  };
}
