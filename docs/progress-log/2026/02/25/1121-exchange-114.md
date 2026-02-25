## 2026-02-25 11:21 MST — Exchange 114

Summary: Made model-load status visibly explicit at startup and model-switch time, and ensured both `/model` and Model Manager selection paths show loading progress messages.
Changed:

- Updated `src/tui.ts`:
  - `startTui(...)` now emits startup preload line before Ink mount when a concrete llama model is configured:
    - `Loading <model> into <GPU/CPU>...`
  - `/model <arg>` flow now appends visible chat output lines:
    - loading line before preload
    - `Model preload complete.` on success
    - existing error output on failure
  - Model Manager `Enter` selection path now also:
    - appends loading line,
    - awaits preload,
    - appends completion line,
      before returning to chat.
- Kept forced local reload path (`resetLlamaForFreshSession`) for explicit model-switch preloads.
  Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-startup-reset.test.ts tests/tui-busy-indicator.test.ts` — clean
- `npm test` — clean (31 files, 285 tests)
  Next:
- Optional: add dedicated tests for model-manager submit preload sequencing and startup preload message emission.
