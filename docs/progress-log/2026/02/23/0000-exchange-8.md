## 2026-02-23 00:00 MST — Exchange 8

Summary: Fixed border overwrite by replacing `inputField()` with a bounded multiline prompt composer that keeps wrapped input inside the prompt box.
Changed:

- Added `src/prompt-composer.ts`:
  - pure layout builder (`buildPromptComposerLayout`) for prefix-aware wrapping inside prompt interior width
  - `PromptComposer` state machine handling insert/edit/navigation, multiline cursor movement, history traversal, and slash autocomplete
- Updated `src/prompt-box.ts`:
  - added `buildPromptBoxFrame(width, statusText, middleRowCount)` for dynamic-height prompt boxes
  - kept `buildPromptBoxLayout(...)` for single-row compatibility
- Reworked `src/tui.ts`:
  - removed `term.inputField(...)` usage
  - integrated custom key-driven composer loop
  - prompt box now grows to multiple middle rows as content wraps and always redraws bounded borders
  - prompt box shrinks back to one row after submit/cancel by clearing composer state
  - resize path now recomputes composer width and re-renders prompt/cursor in-box
  - preserved command parsing, history recording, and backend request flow
- Added/updated tests:
  - new `tests/prompt-composer.test.ts` (5 tests)
  - expanded `tests/prompt-box.test.ts` to cover dynamic frame rows/status clipping
  - expanded `tests/tui-resize-render.test.ts` to verify wrapped prompt content stays border-contained
    Validation:
- `npm run typecheck` — clean
- `npm test` — 101 tests pass (12 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Add a targeted integration test for interactive autocomplete menu selection in the composer loop.
- Add a parity check for non-llama backend status labels during multiline input rendering.
