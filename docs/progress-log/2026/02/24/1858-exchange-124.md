## 2026-02-24 18:58 MST — Exchange 124

Summary: Fixed title-box early displacement when chat contains visually blank newline rows (whitespace/ANSI-only lines) between prompt and content.
Changed:

- Updated `src/tui.ts`:
  - added `isVisuallyEmptyLine(...)` helper using ANSI stripping + trim.
  - updated `computeVisibleLayoutSlices(...)` content/pressure detection to ignore visually blank rows rather than only zero-length strings.
  - prevents whitespace-only/ANSI-styled blank lines from counting toward title collision pressure.
- Updated `tests/tui-resize-render.test.ts`:
  - added regression test asserting whitespace-only rows (plain and ANSI-colored) do not push the title early.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (21 passing)
- `npm run typecheck` — clean
  Next:
- Optional: run `npm test` full suite for additional confidence before release packaging.
