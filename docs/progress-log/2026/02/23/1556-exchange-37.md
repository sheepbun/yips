## 2026-02-23 15:56 MST — Exchange 37

Summary: Hid model and token usage in title/prompt status when no real model is loaded, showing provider-only until a model is available.
Changed:

- Updated `src/tui.ts`:
  - added `resolveLoadedModel(...)` to treat unresolved model values as missing (`""` and `"default"`)
  - `buildTitleBoxOptions(...)` now omits model/token usage when no loaded model is available
  - added `buildPromptStatusText(...)` so prompt border status renders provider-only until a loaded model exists (busy label still appended when active)
- Updated `src/title-box.ts`:
  - `buildModelInfo(...)` now composes provider/model/token from available fields and returns provider-only when model is missing
- Updated `tests/title-box.test.ts`:
  - added regression test verifying model/token text stays hidden when model is missing
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/title-box.test.ts tests/tui-resize-render.test.ts` — clean
  Next:
- Run `npm run dev` for an interactive visual pass to confirm provider-only status appears before model load and model/token appear once a model is set.
