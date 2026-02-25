## 2026-02-22 21:53 MST — Exchange 22

Summary: Extended raw-stdin enter parsing with additional terminal fallbacks likely used by modified-enter keybindings.
Changed:

- Updated `src/input-engine.ts`:
  - added non-CSI modified-enter fallback handling for `ESC+CR` and `ESC+LF` (treated as newline)
  - added SS3 keypad-enter handling (`ESC O M`) mapped to submit
  - changed bare `LF` handling to newline while keeping `CR` as submit (`CRLF` remains submit via CR path)
- Updated `tests/input-engine.test.ts`:
  - adjusted LF expectation from submit to newline
  - added coverage for `ESC+CR` / `ESC+LF` newline mapping
  - added coverage for SS3 keypad-enter submit mapping
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/input-engine.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (115 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Re-test interactive behavior in the user terminal (`npm run dev`) and verify:
  - `Enter` submits
  - `Ctrl+Enter` inserts newline (including terminal variants that encode modified-enter as `LF`, `ESC+CR/LF`, or CSI/SS3 forms).
