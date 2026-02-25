## 2026-02-23 19:35 MST — Exchange 55

Summary: Reduced residual download flashing by decoupling network chunk callbacks from immediate downloader state mutation/render.
Changed:

- Updated `src/tui.ts` download update pipeline:
  - increased download repaint interval to 200ms
  - added `downloaderProgressBufferRef` to buffer the latest `(bytesDownloaded, totalBytes)` from `onProgress`
  - `onProgress` now only writes to buffer + marks dirty (no direct state mutation)
  - timer loop now applies buffered progress to state (`updateDownloadProgress`) and re-renders once per tick
  - clears buffered progress on cancel/finish/error/unmount
- Existing compact download layout and bottom-right status placement remain unchanged.
  Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts` — clean
  Next:
- If flashing persists in a specific terminal emulator, add a terminal capability fallback mode that temporarily disables truecolor gradients while downloading.
