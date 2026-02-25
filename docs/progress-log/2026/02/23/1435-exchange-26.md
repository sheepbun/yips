## 2026-02-23 14:35 MST — Exchange 26

Summary: Fixed prompt anchoring regression by padding the middle viewport so the prompt always renders on the terminal’s bottom rows.
Changed:

- Updated `src/tui.ts`:
  - adjusted `computeVisibleLayoutSlices(...)` to pad middle output rows with blanks when output history is shorter than available middle height
  - this guarantees `title + middle + prompt` always fills the visible row budget, keeping prompt rows bottom-anchored
- Updated `tests/tui-resize-render.test.ts`:
  - added `pads the middle viewport so prompt stays anchored at the bottom` regression test
  - validates blank middle-row padding and exact total row occupancy
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Run `npm run dev` and manually resize the terminal to verify the prompt remains fixed to the bottom under live interaction.
