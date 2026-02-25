## 2026-02-24 11:43 MST — Exchange 71

Summary: Fixed title-box and prompt status to use shortened default model display names instead of raw model paths.
Changed:

- Updated `src/model-manager.ts`:
  - exported `getModelDisplayName(modelId)` and used it as the default model naming rule.
  - `getFriendlyModelName(...)` and `listLocalModels(...)` now share `getModelDisplayName(...)` for consistent naming.
- Updated `src/tui.ts`:
  - title-box model label now uses `getModelDisplayName(...)`.
  - prompt footer status model label now uses `getModelDisplayName(...)`.
  - both no longer render full raw `owner/repo/file.gguf` path when a parent directory label exists.
- Updated `tests/model-manager.test.ts`:
  - added explicit `getModelDisplayName(...)` coverage for nested Qwen GGUF path labels.
    Validation:
- `npm test -- tests/model-manager.test.ts` — clean (9 passing)
- `npm run typecheck` — clean
  Next:
- Optionally run full suite (`npm test`, `npm run lint`) before commit.
