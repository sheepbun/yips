## 2026-02-25 11:17 MST — Exchange 113

Summary: Corrected model preload behavior to perform actual model loading (local server reset on `/model`) and removed startup background preload effect that could interfere with chat flow.
Changed:

- Updated `src/tui.ts`:
  - imported `isLocalLlamaEndpoint`.
  - updated `preloadConfiguredModel(forceReloadLocal)`:
    - when `forceReloadLocal=true` and endpoint is local, it now uses `resetLlamaForFreshSession(...)` (stop + restart with selected model) to guarantee model load.
    - otherwise falls back to `ensureLlamaReady(...)` readiness checks.
  - removed automatic startup `useEffect` preload invocation.
  - `/model <arg>` flow now calls `preloadConfiguredModel(true)` so selected model is actually loaded before next prompt.
- Preserved loading UX label `Loading <model> into <GPU/CPU>...` during explicit preload.
  Validation:
- `npm run typecheck` — clean
- `npm test -- tests/tui-busy-indicator.test.ts tests/llama-server.test.ts tests/commands.test.ts` — clean
- `npm test` — clean (31 files, 285 tests)
  Next:
- Optional: add a dedicated integration test seam for `/model` preload path to assert local reset invocation explicitly.
