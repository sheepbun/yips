## 2026-02-24 10:27 MST — Exchange 43

Summary: Removed LM Studio integration references completely from the TypeScript project.
Changed:

- Updated `src/model-downloader.ts`:
  - default models directory now resolves to `~/.yips/models` (or `YIPS_MODELS_DIR` override)
  - removed `.lmstudio` default path coupling
- Updated docs to remove LM Studio references:
  - `docs/roadmap.md` decision log alternatives
  - `docs/stack.md` yips-cli comparison backend row
  - `docs/changelog.md` legacy LM Studio wording adjusted to backend-generic wording
  - `docs/progress-log.md` prior entry corrected from `~/.lmstudio/models` to `~/.yips/models`
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (15 files, 156 tests)
  Next:
- If desired, add a one-time migration note/command to move existing models from `~/.lmstudio/models` to `~/.yips/models`.
