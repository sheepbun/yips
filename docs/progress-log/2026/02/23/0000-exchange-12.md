## 2026-02-23 00:00 MST — Exchange 12

Summary: Restricted multiline insertion to explicit `Ctrl+Enter` and restored `Ctrl+M` to submit behavior.
Changed:

- Updated `src/prompt-composer.ts`:
  - `CTRL_M` now follows submit behavior with `ENTER`/`KP_ENTER`.
  - Removed newline insertion aliases for `ALT_ENTER`, `SHIFT_ENTER`, and `CTRL_SHIFT_ENTER`.
  - Newline insertion remains only on `CTRL_ENTER`.
- Updated `tests/prompt-composer.test.ts`:
  - revised modified-enter test to assert newline insertion only for `CTRL_ENTER`
  - added assertions that `SHIFT_ENTER`/`ALT_ENTER`/`CTRL_SHIFT_ENTER` do not insert newlines
  - added assertion that `CTRL_M` submits the current text
    Validation:
- `npm test -- tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm run typecheck` — clean
  Next:
- Add a focused integration test that exercises `readPromptInput()` key handling for `CTRL_M` and `CTRL_ENTER` end-to-end.
