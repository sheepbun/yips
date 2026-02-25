## 2026-02-23 19:12 MST — Exchange 51

Summary: Reworked downloader progress rendering to fixed-rate repainting to address persistent flicker; restored original block-style progress bar.
Changed:

- Updated `src/tui.ts` download progress path:
  - removed chunk-cadence `forceRender()` calls from `onProgress`
  - added `downloaderProgressDirtyRef` to mark pending UI updates
  - added fixed-interval progress repaint loop (`100ms`) that renders only when:
    - a progress update is pending
    - UI is in downloader mode
    - downloader phase is `downloading`
  - reset dirty flags on start/finish/error transitions
- Updated `src/downloader-ui.ts`:
  - restored block-style progress bar glyphs (`█` and `░`) per user preference
    Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts` — clean
  Next:
- If any terminal still flickers, add optional low-refresh mode (e.g., 5 FPS) toggled by env var for slower redraw cadence.
