## 2026-02-24 19:03 MST — Exchange 125

Summary: Implemented title-anchor collision fix so trailing newline/spacer rows cannot displace the title box before real content collides.
Changed:

- Updated `src/tui.ts` (`computeVisibleLayoutSlices`):
  - split output into `pressureWindow` (title-displacing content) and `trailingSpacerRows` (post-content blank rows).
  - title displacement now remains driven by `pressureWindow` only.
  - output rendering now includes trailing spacer rows only when row budget remains after title + core output.
  - added explicit row-budget guard to keep rendered output within available rows.
- Updated `tests/tui-resize-render.test.ts`:
  - strengthened trailing-spacer regression to assert spacer row is dropped when constrained and total rendered rows exactly match terminal height.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (21 passing)
- `npm run typecheck` — clean
  Next:
- Optional: run full `npm test` suite before cutting next build tag.
