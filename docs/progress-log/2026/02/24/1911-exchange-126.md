## 2026-02-24 19:11 MST — Exchange 126

Summary: Fixed remaining early title bump by making layout collision math wrapping-aware (visual row counts instead of raw line counts).
Changed:

- Updated `src/tui.ts` (`computeVisibleLayoutSlices`):
  - added visual-row helpers: `visibleCharLength`, `inferRenderWidth`, `lineDisplayRows`, `countDisplayRows`, `dropLeadingByDisplayRows`.
  - title displacement now uses wrapped row counts for output pressure, matching how Ink actually renders long lines.
  - hidden output trimming now drops by visual rows, not raw string rows.
  - trailing spacer rows are still only included when row budget remains.
- Updated `tests/tui-resize-render.test.ts`:
  - added regression `counts wrapped output rows before displacing title` to lock wrapped-line collision behavior.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (22 passing)
- `npm run typecheck` — clean
  Next:
- Optional: run full `npm test` suite to verify no side effects in non-layout paths.
