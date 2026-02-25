## 2026-02-23 00:00 MST — Exchange 15

Summary: Fixed Ink migration regressions for prompt-box border stability, backspace handling, and missing colors.
Changed:

- Updated `src/colors.ts`:
  - migrated styling output to ANSI truecolor escape sequences (replacing terminal-kit markup output)
  - retained existing color helper APIs (`colorText`, `horizontalGradient`, `diagonalGradient`, etc.)
  - added non-regex ANSI stripping helper (`stripAnsi`) for plain-text assertions/utilities
- Updated `src/title-box.ts`:
  - `stripMarkup()` now strips ANSI output (and still strips legacy terminal-kit tokens for compatibility)
- Updated `src/messages.ts` comment to reflect ANSI-based styling pipeline
- Updated `src/tui.ts`:
  - restored color rendering in Ink by removing output-line style stripping
  - prompt frame rendering now applies ANSI colors/gradients to borders and prompt prefix
  - fixed prompt-box right-edge drift by switching cursor rendering from insertion to in-place replacement (`withCursorAt`) and preserving fixed inner width
  - expanded key normalization for destructive input variants (`Backspace`, `DEL` byte, `Ctrl+H`) in `mapInkKeyToComposerKey()`
  - exported `mapInkKeyToComposerKey()` for focused key-path tests
- Updated tests:
  - `tests/colors.test.ts` updated for ANSI assertions
  - `tests/messages.test.ts` updated for ANSI assertions
  - `tests/title-box.test.ts` added ANSI stripping coverage
  - `tests/tui-resize-render.test.ts` now strips ANSI before geometry assertions while verifying styled output is emitted
  - `tests/tui-keys.test.ts` added backspace variant mapping checks
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (110 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Manually verify in a real terminal (`npm run dev`) that prompt border remains visually stable during rapid typing/backspacing and multiline cursor movement.
- If any terminal still emits unusual backspace/control sequences, extend `mapInkKeyToComposerKey()` with targeted normalization based on captured key/input data.
