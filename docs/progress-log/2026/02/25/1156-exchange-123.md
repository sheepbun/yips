## 2026-02-25 11:56 MST — Exchange 123

Summary: Fixed premature title displacement caused by trailing spacer/newline rows after first chat exchange.
Changed:

- Updated `src/tui.ts` (`computeVisibleLayoutSlices`):
  - separated render window (`contentWindow`) from title-collision pressure window (`pressureWindow`).
  - pressure now trims both:
    - leading blank rows before first non-empty output line,
    - trailing blank spacer rows after last non-empty output line.
  - output rendering still preserves trailing spacer rows, so visual spacing before prompt remains.
- Updated `tests/tui-resize-render.test.ts`:
  - added regression test asserting trailing spacer rows do not push title early.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (31 files, 287 tests)
  Next:
- Optional: add a high-level integration harness asserting first user+assistant exchange preserves title visibility for a canonical terminal size.
