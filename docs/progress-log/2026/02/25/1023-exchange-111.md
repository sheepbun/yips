## 2026-02-25 10:23 MST — Exchange 111

Summary: Added chat scrollback navigation so full in-session output remains accessible instead of becoming unreachable after viewport overflow.
Changed:

- Updated `src/input-engine.ts`:
  - added `scroll-page-up` / `scroll-page-down` input actions.
  - mapped CSI page keys (`\x1b[5~`, `\x1b[6~`) to those actions.
- Updated `src/tui.ts`:
  - added runtime `outputScrollOffset` state to track chat viewport position.
  - added `shiftOutputScrollOffset(...)` clamp helper.
  - updated `computeVisibleLayoutSlices(...)` to accept an optional scroll offset and render from the corresponding historical window.
  - wired `PgUp` / `PgDn` handling in chat mode to move by page-sized increments.
  - auto-resets scroll offset to bottom on new output writes/stream replacements and session resets/replays.
  - appended scroll status indicator (`scroll +N`) in prompt footer while scrolled up.
- Updated tests:
  - `tests/input-engine.test.ts` now covers page-key parsing and emitted scroll actions.
  - `tests/tui-resize-render.test.ts` now covers scrollback-offset viewport behavior.
    Validation:
- `npm test -- tests/input-engine.test.ts tests/tui-resize-render.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (31 files, 283 tests)
  Next:
- Optional UX follow-up: add a one-line in-app hint for `PgUp/PgDn` when first entering chat mode.
