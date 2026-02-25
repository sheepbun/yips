## 2026-02-23 19:03 MST — Exchange 48

Summary: Fixed downloader frame instability during loading/downloading and added live model download progress/status rendering.
Changed:

- Extended downloader state machine in `src/downloader-state.ts`:
  - added explicit phases (`idle`, `loading-models`, `loading-files`, `downloading`, `error`)
  - added structured download progress state (`bytesDownloaded`, `totalBytes`, timestamps, status text)
  - added transition helpers: `setLoadingModels`, `setLoadingFiles`, `startDownload`, `updateDownloadProgress`, `finishDownload`, `setDownloaderError`
- Enhanced downloader API in `src/model-downloader.ts`:
  - added optional `onProgress` callback to `DownloadModelFileOptions`
  - emits streaming progress updates while reading chunks
  - reads `content-length` when available and reports unknown total when absent
- Reworked downloader renderer in `src/downloader-ui.ts`:
  - stabilized panel height with fixed body row counts for both model and file views
  - ensured bordered blank fill rows in loading/error/downloading states
  - added dedicated downloading body with activity line, progress bar, and status text
- Updated TUI wiring in `src/tui.ts`:
  - replaced generic loading/error updates with phase-specific downloader transitions
  - integrated `downloadModelFile(..., onProgress)` callback into runtime state updates
  - added byte/speed/ETA status formatting helpers
  - after successful download, return to the file list view in idle phase
- Added and expanded tests:
  - `tests/downloader-state.test.ts`: phase transitions, error transition, and progress updates
  - `tests/downloader-ui.test.ts`: fixed frame height across states, bordered loading rows, downloading progress/status render
  - `tests/model-downloader.test.ts`: progress callback behavior with and without `content-length`
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-state.test.ts tests/downloader-ui.test.ts tests/model-downloader.test.ts` — clean
- `npm test` — 177 passing
- `npm run lint` — clean
  Next:
- Add a focused TUI integration-style render test that verifies downloader progress updates do not shift prompt-box geometry during rapid onProgress re-renders.
