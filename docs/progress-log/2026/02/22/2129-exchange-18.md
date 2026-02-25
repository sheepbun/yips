## 2026-02-22 21:29 MST — Exchange 18

Summary: Restored Ctrl+Enter newline insertion by making raw-sequence parsing resilient to chunked stdin delivery and adding extra key-path normalization.
Changed:

- Updated `src/tui.ts`:
  - added `consumeCtrlEnterUnknownSequence(chunk, carry)` to parse ctrl-enter CSI sequences across split stdin chunks (with carry state)
  - wired ctrl-enter stdin handler to use carry-aware parsing and dispatch one newline per detected sequence
  - added `ctrlEnterCarryRef` to persist parser carry between stdin events
  - expanded `mapInkKeyToComposerKey(...)` to map raw ctrl-enter sequence strings directly and to accept ctrl-modified carriage-return/newline bytes
- Updated `tests/tui-keys.test.ts`:
  - added coverage for `consumeCtrlEnterUnknownSequence(...)` complete-chunk and split-chunk paths
  - added mapping assertions for ctrl-enter raw encoding and ctrl-modified carriage return
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (117 passing)
- `npm run build` — clean
  Next:
- Re-test interactively (`npm run dev`) to confirm Ctrl+Enter inserts newlines reliably in your terminal after this chunked-sequence handling fix.
