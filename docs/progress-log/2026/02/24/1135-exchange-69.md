## 2026-02-24 11:35 MST — Exchange 69

Summary: Updated model friendly-name fallback so nested GGUF model variants display their parent GGUF folder name instead of long quantized filenames.
Changed:

- Updated `src/model-manager.ts`:
  - `toFriendlyNameFallback(...)` now checks nested path segments for `.gguf` files.
  - when the immediate parent directory name contains `gguf` (case-insensitive), it is used as the fallback display name.
  - otherwise existing behavior remains (filename stem without `.gguf`).
- Updated `tests/model-manager.test.ts`:
  - added regression coverage for `Qwen/Qwen3-VL-2B-Instruct-GGUF/Qwen3VL-2B-Instruct-Q4_K_M.gguf` expecting `Qwen3-VL-2B-Instruct-GGUF`.
  - added `listLocalModels(...)` coverage verifying both `name` and `friendlyName` use the GGUF parent folder for nested variants.
    Validation:
- `npm test -- tests/model-manager.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
  Next:
- Optionally run full suite (`npm test`, `npm run lint`) if you want broader regression validation before the next commit.
