## 2026-02-23 19:32 MST — Exchange 54

Summary: Made downloading view fully compact with no empty body lines and moved status text to the bottom-right footer.
Changed:

- Updated `src/downloader-ui.ts` downloading-mode rendering:
  - removed the tabs/header row while downloading
  - reduced downloading body to only 2 rows: `Downloading ...` and full-width progress bar
  - removed padded blank rows in downloading mode
  - footer in downloading mode now renders split content:
    - left: `[Esc] Cancel`
    - right: live `statusText` (download bytes/speed/ETA), right-aligned inside the box
- Added `lineWithSplitFooter(...)` helper for left/right aligned footer text within bordered row width constraints.
- Updated `tests/downloader-ui.test.ts` expectations:
  - downloading panel height now `5` lines total
  - asserts no blank bordered lines in downloading mode
  - keeps assertions for hidden tabs and cancel footer
    Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts tests/downloader-ui.test.ts` — clean
  Next:
- If desired, apply the same split-footer pattern to non-downloading file view for richer right-side context in a single row.
