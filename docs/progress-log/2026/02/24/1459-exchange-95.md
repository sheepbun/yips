## 2026-02-24 14:59 MST — Exchange 95

Summary: Fixed Thinking-row ordering and restored smooth yips-cli-style color pulsing.
Changed:

- Updated `src/tui.ts` streaming request path:
  - removed pre-stream empty assistant placeholder append.
  - `blockLength` now starts at `0`, so no timestamped Yips assistant header is rendered above `Thinking...` before first token.
  - first token now inserts the assistant block directly via `replaceOutputBlock(...)`.
- Updated `src/spinner.ts` color animation timing:
  - color pulse now uses fractional elapsed seconds (`(now - startTime) / 1000`) instead of integer seconds.
  - keeps elapsed-time text formatting as whole seconds for display.
  - result: smooth continuous pink↔yellow oscillation matching yips-cli behavior.
- Updated `tests/spinner.test.ts`:
  - added sub-second oscillation regression assertion to verify color changes within fractional seconds.
    Validation:
- `npm test -- tests/spinner.test.ts tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts` — clean (29 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional manual visual check with `npm run dev` to verify no timestamp/header appears before first streaming token and color pulsing looks right in your terminal.
