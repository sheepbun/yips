## 2026-02-25 13:45 MST — Exchange 135

Summary: Fixed remaining chat overscroll by capping at the first valid full top viewport instead of allowing extra offset rows.
Changed:

- Updated `src/tui.ts`:
  - added `computeUsefulOutputScrollCapRows(...)` to derive a practical scroll cap from viewport geometry (rows/title/prompt/width), not only structural output length.
  - `computeVisibleLayoutSlices(...)` now uses the practical cap for clamping/`isAtTopOfScrollback`, preventing extra upward scroll that produced empty overscroll frames.
  - `computeTitleVisibleScrollCap(...)` now returns the same practical cap so input handlers and renderer use identical stop conditions.
- Updated `tests/tui-resize-render.test.ts`:
  - added regression test proving scroll stops at the first full-top frame (`out-0` visible with more than one output row) instead of overscrolling.

Validation:

- `npm test -- tests/tui-resize-render.test.ts tests/input-engine.test.ts` — clean (42 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean

Next:

- Manual live-terminal pass to verify the exact feel of wheel/page scrolling in the user's terminal profile.
