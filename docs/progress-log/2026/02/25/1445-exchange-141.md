## 2026-02-25 14:45 MST — Exchange 141

Summary: Completed Milestone 3 hardware detection roadmap gap by adding GPU/VRAM-aware startup model auto-selection.
Changed:

- Added hardware-aware model chooser in `src/model-manager.ts`:
  - new `selectBestModelForHardware(models, specs)`.
  - selection policy:
    - prefer the largest runnable model that fits detected VRAM when GPU memory is available,
    - otherwise fall back to the largest runnable model that fits overall RAM+VRAM suitability.
- Updated startup flow in `src/tui.ts`:
  - added `applyHardwareAwareStartupModelSelection(...)`.
  - `startTui(...)` now runs this selection step before `ensureFreshLlamaSessionOnStartup(...)`.
  - behavior applies only when backend is `llamacpp` and configured model is unresolved (`default`/empty).
  - selected model is persisted via `saveConfig(...)` so subsequent starts keep the resolved model.
- Added tests:
  - `tests/model-manager.test.ts` now covers VRAM-fit preference and fallback selection behavior.
  - `tests/tui-startup-reset.test.ts` now covers startup auto-selection/persist behavior and skip-when-already-selected behavior.
- Updated docs:
  - `docs/roadmap.md`: marked Milestone 3 `Hardware detection: GPU/VRAM-aware model selection` complete.
  - `docs/changelog.md`: added unreleased notes for startup auto-selection and milestone status update.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/model-manager.test.ts tests/tui-startup-reset.test.ts` — clean
- `npm test` — clean (34 files, 317 tests)

Next:

- Implement Milestone 3 memory system (`save/read/list conversation memories`) or hooks (`user-defined lifecycle scripts`) as the next unchecked roadmap item.
