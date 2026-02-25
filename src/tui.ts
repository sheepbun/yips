/** Main TUI entrypoint and compatibility exports. */

import React from "react";

import { getVersion } from "./version";
import { createInkApp, type InkModule } from "./tui/app";
import {
  applyHardwareAwareStartupModelSelection,
  ensureFreshLlamaSessionOnStartup
} from "./tui/startup";
import type { TuiOptions } from "./types";

export {
  buildAutocompleteOverlayLines,
  buildModelAutocompleteCandidates,
  buildPromptRenderLines,
  buildPromptStatusText,
  composeChatRequestMessages,
  composeOutputLines,
  computeTitleVisibleScrollCap,
  computeTokensPerSecond,
  computeVisibleLayoutSlices,
  formatModelLoadingLabel,
  formatTitleCwd,
  formatTokensPerSecond,
  renderHistoryLines,
  resolveModelLoadTarget,
  runOnceGuarded,
  shouldConsumeSubmitForAutocomplete
} from "./tui/app";

export { applyHardwareAwareStartupModelSelection, ensureFreshLlamaSessionOnStartup } from "./tui/startup";

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
