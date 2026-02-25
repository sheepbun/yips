## 2026-02-24 12:59 MST — Exchange 79

Summary: Updated downloader and model-manager title styling so `Yips` stays pink/yellow gradient and the feature label is light blue, matching title-box style intent.
Changed:

- Updated `src/downloader-ui.ts`:
  - `makeBorderTop(...)` now renders title in two parts:
    - `Yips` with pink→yellow gradient
    - ` Model Downloader` in `GRADIENT_BLUE`
  - kept bold title styling and existing offset-based border gradient for non-title segments.
- Updated `src/model-manager-ui.ts`:
  - `makeBorderTop(...)` now renders:
    - `Yips` with pink→yellow gradient
    - `Model Manager` in `GRADIENT_BLUE`
- Updated tests:
  - `tests/downloader-ui.test.ts` now asserts downloader top line includes light-blue title segment coloring.
  - `tests/model-manager-ui.test.ts` now asserts model-manager top line includes light-blue title segment coloring.
    Validation:
- `npm test -- tests/downloader-ui.test.ts tests/model-manager-ui.test.ts tests/tui-resize-render.test.ts` — clean (26 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional visual check in `npm run dev` to confirm the title split looks exactly as intended in your terminal font/theme.
