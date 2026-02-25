/** Main TUI entrypoint and compatibility exports. */

import React from "react";

import { getVersion } from "#app/version";
import { createInkApp, type InkModule } from "#ui/tui/app";
import {
  applyHardwareAwareStartupModelSelection,
  ensureFreshLlamaSessionOnStartup
} from "#ui/tui/startup";
import type { TuiOptions } from "#types/app-types";

export {
  composeChatRequestMessages,
  renderHistoryLines
} from "#ui/tui/history";
export {
  buildAutocompleteOverlayLines,
  buildModelAutocompleteCandidates,
  shouldConsumeSubmitForAutocomplete
} from "#ui/tui/autocomplete";
export {
  buildPromptRenderLines,
  buildPromptStatusText,
  composeOutputLines,
  computeTitleVisibleScrollCap,
  computeVisibleLayoutSlices
} from "#ui/tui/layout";
export {
  computeTokensPerSecond,
  formatModelLoadingLabel,
  formatTitleCwd,
  formatTokensPerSecond,
  resolveModelLoadTarget,
  runOnceGuarded
} from "#ui/tui/runtime-utils";

export { applyHardwareAwareStartupModelSelection, ensureFreshLlamaSessionOnStartup } from "#ui/tui/startup";

export async function startTui(options: TuiOptions): Promise<"exit" | "restart"> {
  let restartRequested = false;
  await applyHardwareAwareStartupModelSelection(options);
  await ensureFreshLlamaSessionOnStartup(options);
  const version = await getVersion();
  const ink = (await import("ink")) as unknown as InkModule;
  const App = createInkApp(ink);
  const instance = ink.render(
    React.createElement(App, {
      options,
      version,
      onRestartRequested: () => {
        restartRequested = true;
      }
    }),
    {
      exitOnCtrlC: false
    }
  );

  await instance.waitUntilExit();
  return restartRequested ? "restart" : "exit";
}
