## 2026-02-24 11:38 MST — Exchange 70

Summary: Changed GGUF naming strategy from conditional fallback to default parent-folder naming for nested model paths.
Changed:

- Updated `src/model-manager.ts`:
  - `toFriendlyNameFallback(...)` now defaults to immediate parent directory name for nested `.gguf` model IDs.
  - retained filename-stem behavior only when there is no parent directory segment.
  - preserved nickname compatibility by checking both default name key and filename-stem key (e.g., `qwen`) in `getFriendlyModelName(...)`.
- Updated `tests/model-manager.test.ts`:
  - revised naming tests to assert parent-folder default behavior.
  - added explicit coverage that `org/repo/model-q4.gguf` defaults to `repo`.
    Validation:
- `npm test -- tests/model-manager.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
  Next:
- Optionally run full suite (`npm test`, `npm run lint`) before commit.
