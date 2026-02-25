## 2026-02-23 00:00 MST — Exchange 11

Summary: Hardened modified-Enter handling across terminal variants so newline insertion works when terminals emit non-standard `Ctrl+Enter` sequences.
Changed:

- Updated `src/prompt-composer.ts`:
  - newline insertion now accepts `ALT_ENTER`, `SHIFT_ENTER`, and `CTRL_SHIFT_ENTER` in addition to `CTRL_ENTER`/`CTRL_M`
  - newline-aware layout logic retained with hard line breaks preserved in wrapped rows
- Updated `src/tui.ts`:
  - added unknown-sequence parser for modified Enter CSI variants (`\x1b[13;5u`, `\x1b[13;5~`, `\x1b[27;5;13~`, `\x1b[27;13;5~`)
  - while composing, matching unknown sequences are translated to `CTRL_ENTER` newline insertion and redrawn in-box
  - prompt cleanup now unregisters both `key` and `unknown` listeners
    Validation:
- `npm run typecheck` — clean
- `npm test` — 103 tests pass (12 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Add a focused integration test that injects unknown modified-enter sequences into the composer loop.
- Consider exposing active key-sequence diagnostics in a debug mode to simplify terminal-specific input support.
