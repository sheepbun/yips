## 2026-02-24 19:44 MST — Exchange 129

Summary: Capped chat scrollback at the first real message so maximum scroll-up stops with the title at the top and first chat content directly beneath it.
Changed:

- Updated `src/tui.ts` scroll offset and viewport rules:
  - `shiftOutputScrollOffset(...)` now computes max offset from the first non-empty output line, preventing overscroll into pre-content blank space.
  - `computeVisibleLayoutSlices(...)` now clamps incoming `outputScrollOffset` with the same first-content rule.
  - when scrolled (`offset > 0`) and output height is underfilled, padding is now appended below visible output instead of above it, so earliest messages anchor below title.
- Updated `tests/tui-resize-render.test.ts`:
  - adjusted existing scrollback expectation for scrolled underfill behavior.
  - added regression: top scrollback cap keeps first content line visible directly under title when a large offset is requested.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (31 files, 293 tests)
  Next:
- Optional: add a focused unit test for `shiftOutputScrollOffset(...)` if a small pure helper seam is introduced in future refactors.
