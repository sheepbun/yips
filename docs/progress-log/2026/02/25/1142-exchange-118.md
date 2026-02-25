## 2026-02-25 11:42 MST — Exchange 118

Summary: Fixed title-box bump threshold so spacer-only output rows do not push the title off-screen before visible content reaches it.
Changed:

- Updated `src/tui.ts` (`computeVisibleLayoutSlices`):
  - added leading-content detection for the active output window.
  - title displacement pressure now uses `pressureWindow` starting at first non-empty output line.
  - this prevents accumulated leading blank spacer rows from counting as title-collision pressure.
- Updated `tests/tui-resize-render.test.ts`:
  - added regression case verifying title remains fully visible when output window has many leading blank rows before first visible content line.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (31 files, 286 tests)
  Next:
- Optional: add a second regression case combining scrollback offset + leading spacer rows to lock behavior while paging through history.
