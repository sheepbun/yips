## 2026-02-23 19:22 MST — Exchange 52

Summary: Implemented download-screen UX corrections: clear previous list chrome while downloading, full-width progress bar, and real Esc cancel behavior.
Changed:

- Updated `src/downloader-ui.ts` downloading layout:
  - hides tabs/memory header row while `phase === downloading` (renders a cleared row instead)
  - footer now shows `[Esc] Cancel` during active download
  - progress bar width now fills available inner row width (no 40-char cap)
- Updated `src/model-downloader.ts`:
  - added `signal?: AbortSignal` to `DownloadModelFileOptions`
  - passes `signal` to `fetch` for cancellation
- Updated `src/tui.ts` cancellation flow:
  - added `AbortController` ref for active downloader transfer
  - `Esc` in downloader while downloading now aborts transfer, clears downloading phase, and logs `Download canceled.` to output
  - abort errors are treated as cancellation (not surfaced as downloader error)
  - teardown now aborts any active download controller
- Updated tests in `tests/downloader-ui.test.ts`:
  - verifies downloading view hides tabs row text
  - verifies downloading footer is `[Esc] Cancel`
  - verifies progress line consumes row width up to the right border
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-ui.test.ts tests/model-downloader.test.ts tests/downloader-state.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts src/model-downloader.ts tests/downloader-ui.test.ts` — clean
  Next:
- If any terminal still shows visual flicker, add a dedicated optional low-FPS download repaint mode (`YIPS_DOWNLOADER_FPS`) for user-tunable cadence.
