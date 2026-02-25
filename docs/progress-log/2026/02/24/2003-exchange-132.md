## 2026-02-24 20:03 MST — Exchange 132

Summary: Fixed title/output scroll desync by making scrolled mode use a consistent fixed-title viewport and by tightening cap semantics to the farthest valid title-visible offset.
Changed:

- Updated `src/tui.ts`:
  - `computeVisibleLayoutSlices(...)` now treats any non-zero scroll offset as explicit scroll mode:
    - title remains fixed/visible,
    - no title-gap/title-displacement pressure is applied while scrolled,
    - output rendering no longer mixes live-mode collision rules with scroll-mode state.
  - `computeTitleVisibleScrollCap(...)` now returns the farthest matching offset (highest valid), not the first matching offset, so scroll range remains usable while still respecting title visibility constraints.
- Updated `tests/tui-resize-render.test.ts`:
  - updated scrolled-layout expectation to reflect fixed-title scroll mode in narrow viewport.
  - retained cap behavior regression.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (31 files, 294 tests)
  Next:
- Optional: add an explicit integration-style stdin scroll test to verify repeated wheel/page events preserve title/output lockstep under live rerender conditions.
