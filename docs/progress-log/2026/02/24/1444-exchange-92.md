## 2026-02-24 14:44 MST — Exchange 92

Summary: Reimplemented the pre-response “Thinking ...” loading indicator as a transient animated output-line spinner (ported behavior from yips-cli), including streaming-first-token stop and retry wait coverage.
Changed:

- Updated `src/tui.ts`:
  - imported and integrated `PulsingSpinner` into the Ink runtime via a transient `busySpinnerRef`.
  - added `BUSY_SPINNER_RENDER_INTERVAL_MS` (80ms) and a busy animation render tick so spinner frames/time update while waiting.
  - added `startBusyIndicator(...)` / `stopBusyIndicator()` helpers and replaced direct busy-label toggles in llama request flow.
  - non-streaming requests now show animated `Thinking...` until completion.
  - streaming requests now show animated `Thinking...` until first token arrives, then hide spinner.
  - streaming fallback retry now shows animated `Retrying...` while fallback non-stream request runs.
  - removed busy-label text from prompt status builder, keeping status focused on provider/model.
  - added exported `composeOutputLines(...)` helper and switched output assembly to append transient busy line in output panel.
- Added `tests/tui-busy-indicator.test.ts`:
  - verifies transient busy line is appended after output/autocomplete rows.
  - verifies busy line is omitted when not provided.
  - verifies prompt status text no longer includes `Thinking...` when busy.
    Validation:
- `npm test -- tests/tui-busy-indicator.test.ts tests/spinner.test.ts tests/tui-resize-render.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (24 files, 241 tests)
  Next:
- Optional manual visual pass with `npm run dev` to confirm the transient busy row behavior feels right in your terminal while waiting for first streaming token.
