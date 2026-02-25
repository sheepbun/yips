## 2026-02-24 14:47 MST — Exchange 93

Summary: Made Model Manager model selection persist before leaving the panel so startup consistently loads the last selected model.
Changed:

- Updated `src/tui.ts` model-manager submit path:
  - replaced fire-and-forget `saveConfig(...)` call with an awaited async flow.
  - added temporary loading state (`Saving selected model...`) while persisting selection.
  - now switches back to chat only after config save succeeds.
  - on save failure, stays in Model Manager and surfaces an inline error (`Failed to save model selection: ...`).
  - preserves existing behavior of setting backend to `llamacpp` and setting `config.model` to selected model id.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts tests/commands.test.ts` — clean (51 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional manual check with `npm run dev`: select a model in Model Manager, restart Yips, and confirm the same model is loaded on startup.
