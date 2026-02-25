## 2026-02-25 13:25 MST — Exchange 180

Summary: Implemented anti-batching UI flush for incremental action rendering, added sequencing tests, and rebuilt `dist` for source/binary parity.
Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - Added `yieldToUi()` helper (`setImmediate` with `setTimeout(..., 0)` fallback).
  - Added `flushUiRender(render)` helper that forces render and yields to the event loop.
  - Updated `runWithBusyLabel(...)` to flush after starting and stopping the busy indicator.
  - Added local `flushUi()` callback in `createInkApp(...)`.
  - In `executeToolCalls`, `executeSkillCalls`, and `executeSubagentCalls`, replaced immediate-only render calls with awaited flush points:
    - after appending action call box,
    - after appending action result and spacer line,
    - after restarting `Thinking...` between action steps.
  - Applied the flush behavior in success and deny/error branches.
- Added test `tests/ui/tui/tui-ui-flush.test.ts`:
  - verifies `yieldToUi()` resolves asynchronously,
  - verifies `flushUiRender()` invokes render immediately and resolves after yielding.
- Extended `tests/agent/conductor.test.ts`:
  - new mixed-outcome multi-action test validating declared per-action execution/result ordering.
- Rebuilt distribution artifacts via `npm run build` so `dist/**` reflects source changes.

Validation:

- `npm run typecheck` — clean
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts tests/ui/tui/tui-ui-flush.test.ts tests/agent/conductor.test.ts tests/gateway/headless-conductor.test.ts` — clean
- `npm run build` — clean

Next:

- Manually verify interactive behavior in both launcher modes:
  - `yips` (source path),
  - `YIPS_USE_DIST=1 yips` (dist path),
  confirming each tool call/result appears progressively with `Thinking...` resuming between actions.
