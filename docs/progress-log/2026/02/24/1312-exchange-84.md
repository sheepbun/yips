## 2026-02-24 13:12 MST — Exchange 84

Summary: Added downloader cancel confirmation UX and automatic partial-file cleanup for canceled/failed downloads.
Changed:

- Updated `src/downloader-state.ts`:
  - added `cancelConfirmOpen` state flag.
  - added `openCancelConfirm(...)` and `closeCancelConfirm(...)` helpers.
  - ensured phase transitions (`finishDownload`, errors, loading/view transitions) clear cancel confirmation state.
- Updated `src/downloader-ui.ts`:
  - downloading mode now supports a confirm prompt view: `Cancel download and delete partial file?`.
  - footer controls switch to `[Enter] Yes  [Esc] No` while confirm is open.
- Updated `src/tui.ts`:
  - pressing cancel during active download now opens confirm prompt instead of immediate abort.
  - pressing `Esc` again dismisses confirm and resumes download.
  - pressing `Enter` while confirm is open aborts and finalizes cancel flow.
- Updated `src/model-downloader.ts`:
  - `downloadModelFile(...)` now removes partial output file on any failed/incomplete download before re-throwing the original error.
- Added/updated tests:
  - `tests/downloader-state.test.ts` for cancel-confirm state transitions.
  - `tests/downloader-ui.test.ts` for cancel-confirm rendering.
  - `tests/model-downloader.test.ts` for partial-file cleanup on stream failure.
    Validation:
- `npm test -- tests/downloader-state.test.ts tests/downloader-ui.test.ts tests/model-downloader.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional interactive check in `npm run dev`: start a large model download, press `Esc` to open confirm, `Esc` to resume, then `Esc` + `Enter` to cancel and verify no partial `.gguf` remains.
