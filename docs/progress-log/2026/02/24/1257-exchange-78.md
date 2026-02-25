## 2026-02-24 12:57 MST — Exchange 78

Summary: Restored standalone title gradient for downloader header text while keeping continuous border gradient behavior outside the title segment.
Changed:

- Updated `src/downloader-ui.ts`:
  - `makeBorderTop(...)` now renders `Yips Model Downloader` with its own local pink→yellow gradient again.
  - retained offset-based border gradient coloring for prefix/tail/fill/right-corner so non-title border segments do not restart.
- Updated `tests/downloader-ui.test.ts`:
  - revised top-border gradient assertion to require title-start pink (standalone title gradient) and non-pink continuation after the title segment.
    Validation:
- `npm test -- tests/downloader-ui.test.ts tests/tui-resize-render.test.ts` — clean (23 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional visual pass in `npm run dev` to confirm this exactly matches your intended title-vs-border gradient behavior.
