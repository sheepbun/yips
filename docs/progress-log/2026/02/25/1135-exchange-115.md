## 2026-02-25 11:35 MST — Exchange 115

Summary: Fixed streaming regression and adjusted model-manager selection flow so model loading status appears in chat after exiting manager.
Changed:

- Updated `src/tui.ts` streaming behavior:
  - changed tool-loop assistant request call from `requestAssistantFromLlama(false)` to `requestAssistantFromLlama()` so runtime `/stream` setting is respected again.
- Updated `src/tui.ts` model-manager submit behavior:
  - on model selection, UI now exits Model Manager to chat immediately.
  - model save + preload now runs from chat mode and appends visible output lines:
    - `Model set to: ...`
    - `Loading <model> into <GPU/CPU>...`
    - `Model preload complete.` (or error output on failure)
  - avoids showing preload inside manager-only loading state.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (31 files, 285 tests)
  Next:
- Optional: add dedicated regression tests for model-manager submit sequencing (exit-to-chat before preload output) and `/stream` propagation through tool-loop request path.
