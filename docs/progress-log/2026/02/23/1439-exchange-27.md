## 2026-02-23 14:39 MST — Exchange 27

Summary: Updated viewport behavior so output can scroll the title box off-screen while keeping the prompt anchored to the bottom.
Changed:

- Updated `src/tui.ts`:
  - changed `computeVisibleLayoutSlices(...)` to treat the upper region as a single scrollable stack of `title + output`
  - upper viewport now renders the tail of that stack, allowing output growth to progressively displace and eventually hide title lines
  - retained top padding for sparse history so total rows still fill terminal height and prompt remains bottom-anchored
- Updated `tests/tui-resize-render.test.ts`:
  - revised slice expectations to reflect stacked upper-tail behavior
  - added/updated coverage verifying output can fully bump title off-screen
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Verify live UX in `npm run dev` to confirm title displacement feels correct during long conversations and terminal resizes.
