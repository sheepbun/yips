## 2026-02-22 21:47 MST — Exchange 21

Summary: Reworked prompt input handling around a single raw-stdin input engine, removing the mixed event pipeline that caused newline/backspace instability.
Changed:

- Added `src/input-engine.ts`:
  - new `InputAction` contract for semantic prompt actions (`insert`, `submit`, `newline`, navigation, delete/backspace, cancel)
  - new `InputEngine` class that parses raw stdin bytes deterministically with carry-safe CSI handling
  - CSI parsing supports unmodified/modified Enter, legacy modifyOtherKeys Enter forms, arrows/home/end/delete, and control-byte handling
- Refactored `src/tui.ts`:
  - integrated `InputEngine` as the sole prompt-editing input source
  - removed mixed `useInput` + multiple raw-listener editing paths in favor of one `stdin.on("data")` action loop
  - added `applyInputAction(...)` to map engine actions into `PromptComposer` events
  - retained optional `YIPS_DEBUG_KEYS=1` debug output, now showing parsed action summaries per chunk
- Replaced old key-mapping regression tests:
  - removed `tests/tui-keys.test.ts` coverage tied to old TUI key-mapping helpers
  - added `tests/input-engine.test.ts` for the new input engine behavior (including split-chunk sequences and UTF-8 boundary handling)
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (113 passing)
- `npm run build` — clean
- `npm run format:check` — clean
- `printf '/exit\n' | npm run dev -- --no-tui` — clean
  Next:
- Re-test interactive TUI behavior (`npm run dev`) in the user’s terminal to confirm `Ctrl+Enter` newline and `Enter` submit now behave consistently with the new single-path input engine.
