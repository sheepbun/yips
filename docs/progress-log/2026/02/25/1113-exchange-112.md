## 2026-02-25 11:13 MST — Exchange 112

Summary: Added explicit blocking model preloading so llama.cpp model initialization finishes before first prompt handling, with visible `Loading <model> into <GPU/CPU>...` status.
Changed:

- Updated `src/tui.ts`:
  - added `resolveModelLoadTarget(...)` and `formatModelLoadingLabel(...)` helpers.
  - added `preloadConfiguredModel()` runtime hook that:
    - skips non-llamacpp or unresolved/default model configs,
    - shows busy spinner label `Loading <friendly-model-name> into <GPU/CPU>...`,
    - blocks on `ensureLlamaReady(...)` and surfaces startup failures immediately in output.
  - startup now triggers model preload via effect, so model/server warmup happens before user sends first prompt.
  - `/model <arg>` command path now immediately preloads newly selected model and reports preload failure inline.
- Updated tests:
  - `tests/tui-busy-indicator.test.ts` now verifies GPU/CPU loading label formatting.
    Validation:
- `npm test -- tests/tui-busy-indicator.test.ts tests/tui-startup-reset.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (31 files, 285 tests)
  Next:
- Optional UX follow-up: add a one-time explanatory line when preload starts (for users who miss spinner text on very fast loads).
