## 2026-02-25 11:50 MST — Exchange 121

Summary: Eliminated remaining successful model-switch output artifacts that could still contribute to title-box bump pressure.
Changed:

- Updated `src/tui.ts`:
  - removed trailing blank append after successful Model Manager model switch preload.
  - with prior changes, successful model switches now add no persistent output lines in TUI.
  - errors still append visible diagnostics.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-resize-render.test.ts` — clean
  Next:
- If bump still appears after first prompt in your terminal size, capture exact `rows/cols` and first-message line count to tune the collision threshold with a deterministic fixture.
