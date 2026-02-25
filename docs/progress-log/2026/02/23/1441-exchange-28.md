## 2026-02-23 14:41 MST — Exchange 28

Summary: Adjusted upper-viewport padding so the title starts at the top initially, while still allowing output growth to push it off-screen later.
Changed:

- Updated `src/tui.ts`:
  - refined `computeVisibleLayoutSlices(...)` for non-overflow cases to place blank padding after `title + output` (not before), keeping title top-aligned at startup
  - added explicit `upperRowCount === 0` guard so prompt-only height does not render title/output rows
- Updated `tests/tui-resize-render.test.ts`:
  - updated padding regression expectation to assert title-first rendering with trailing upper-region blanks
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Validate interactively with `npm run dev` that initial render shows title at top and long output subsequently displaces it as intended.
