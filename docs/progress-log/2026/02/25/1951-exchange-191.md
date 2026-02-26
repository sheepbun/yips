## 2026-02-25 19:51 MST — Exchange 191

Summary: Implemented TUI mouse capture toggle for selection/copy workflows and added full pre-exit transcript dumping to terminal scrollback.

Changed:

- Updated `src/agent/commands/commands.ts`:
  - extended `CommandResult.uiAction` with `set-mouse-capture` modes (`on|off|toggle|status`).
  - added `/mouse` command with parsing for `toggle` (default), `on|enable`, `off|disable`, `status`, plus usage output for invalid args.
- Updated `src/agent/commands/command-catalog.ts`:
  - added restored command metadata for `/mouse` so help/autocomplete/catalog include it.
- Updated `src/ui/tui/runtime-core.ts`:
  - added `mouseCaptureEnabled` to `RuntimeState` (default `false`, selection-first).
  - changed mouse reporting effect from unconditional enable to state-driven enable/disable with defensive cleanup disable.
  - added UI action handling for `set-mouse-capture` to update runtime mode and render user-facing status messages.
  - added reusable `buildRuntimeRenderLines` and exported `composeFullTranscriptLines` helper.
  - refactored render path to use shared line builder to keep transcript/render output aligned.
  - enhanced `finalizeAndExit` to capture full transcript lines and pass them to `onExitTranscript` only for true exits (not restart).
- Updated `src/ui/tui/start-tui.ts`:
  - wired `onExitTranscript` callback into app creation.
  - prints captured transcript to `stdout` after Ink exits only when result is true exit.
- Updated tests:
  - `tests/agent/commands/commands.test.ts`: added `/mouse` command presence and behavior coverage.
  - new `tests/ui/tui/tui-transcript-compose.test.ts`: validates full transcript section ordering and uncropped inclusion.
  - new `tests/ui/tui/tui-start-exit-dump.test.ts`: validates transcript print on exit and suppression on restart.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/agent/commands/commands.test.ts tests/ui/tui/tui-transcript-compose.test.ts tests/ui/tui/tui-start-exit-dump.test.ts` — clean.
- `npm test -- tests/ui/input/input-engine.test.ts tests/ui/tui/tui-resize-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean.

Next:

- Manually run the TUI in a real terminal and verify:
  - default drag-selection/copy works,
  - `/mouse on` enables wheel scroll capture,
  - `/mouse off` returns to selection-friendly mode,
  - exiting prints full title+chat+prompt transcript in scrollback.
