## 2026-02-23 19:26 MST — Exchange 53

Summary: Reduced downloader panel height specifically for active download mode.
Changed:

- Updated `src/downloader-ui.ts`:
  - added `DOWNLOADER_DOWNLOADING_BODY_ROWS = 7`
  - download-phase renderer now uses the compact body row count while keeping model/file browsing heights unchanged
- Updated `tests/downloader-ui.test.ts`:
  - adjusted download-mode frame height expectation from 14 lines to 11 lines
    Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts tests/downloader-ui.test.ts` — clean
  Next:
- If desired, make compact height configurable by terminal size (e.g., adaptive body rows based on `rows`), instead of a fixed constant.
