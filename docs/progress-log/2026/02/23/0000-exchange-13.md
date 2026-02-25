## 2026-02-23 00:00 MST — Exchange 13

Summary: Restored Ctrl+Enter newline behavior across more terminal variants by normalizing key names and broadening unknown-sequence detection.
Changed:

- Updated `src/tui.ts`:
  - added `normalizePromptComposerKey()` to map ctrl-enter aliases (including `CTRL_M` and ctrl-modified enter variants) to `CTRL_ENTER`
  - replaced fixed-sequence matching with parser-based `isCtrlEnterUnknownSequence()` handling CSI-u and modifyOtherKeys forms
  - Ctrl modifier detection now uses modifier bitmask semantics, so `Ctrl+Shift+Enter` and `Ctrl+Alt+Enter` variants are accepted as ctrl-enter newline inputs
  - kept plain `ENTER` submit path unchanged in composer-level behavior
- Added `tests/tui-keys.test.ts`:
  - validates key-name normalization for ctrl-enter aliases
  - validates unknown-sequence parsing for ctrl-enter across multiple encodings
  - validates rejection of non-ctrl and non-enter sequences
    Validation:
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm run lint` — clean
- `npm run typecheck` — clean
  Next:
- If a terminal still fails to emit a distinguishable ctrl-enter sequence, add optional debug logging for incoming key/unknown events to capture raw sequences and map them explicitly.
