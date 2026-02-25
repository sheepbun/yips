## 2026-02-24 13:03 MST — Exchange 81

Summary: Renamed downloader model-table `DL` header to `Downloads` while keeping column alignment intact.
Changed:

- Updated `src/downloader-ui.ts`:
  - changed model-list header label from `DL` to `Downloads`.
  - increased downloads column width from `8` to `10` so the longer header text does not break alignment.
- Updated `tests/downloader-ui.test.ts`:
  - header detection assertions now look for `Downloads` instead of `DL`.
    Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional visual pass in `npm run dev` to verify column spacing looks ideal at your normal terminal width.
