## 2026-02-23 19:09 MST — Exchange 50

Summary: Reduced download-screen flicker and hardened download-view border stability.
Changed:

- Updated `src/tui.ts` download progress rendering path:
  - throttled `forceRender()` during `onProgress` updates using time and byte gates
  - added constants:
    - `DOWNLOADER_PROGRESS_RENDER_INTERVAL_MS = 80`
    - `DOWNLOADER_PROGRESS_RENDER_STEP_BYTES = 512 * 1024`
  - preserved immediate render at start and completion
- Updated `src/downloader-ui.ts` progress bar glyphs to ASCII width-safe characters:
  - `[████░░░░]` style replaced with `[====----]`
- Updated `src/tui.ts` download status text separators to ASCII (`|`) to avoid terminal-width ambiguity in downloader rows.
  Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts` — clean
  Next:
- If flicker persists on very high-throughput links, add a dedicated sampled progress state timer (e.g., 10 FPS) so render cadence is fully decoupled from network chunk cadence.
