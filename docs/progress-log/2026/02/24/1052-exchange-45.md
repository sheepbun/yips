## 2026-02-24 10:52 MST — Exchange 45

Summary: Continued downloader restoration with closer yips-cli behavior parity for ranking, compatibility heuristics, and file selection safety.
Changed:

- Updated `src/downloader-state.ts`:
  - `Top Rated` now maps to Hugging Face `trendingScore` (matching legacy downloader semantics).
- Updated `src/model-downloader.ts`:
  - RAM/VRAM suitability now uses the same 1.2x memory heuristic as yips-cli (`TOTAL_MEM_GB * 1.2`).
  - file list flow now keeps oversized GGUF files visible with `canRun=false` + reason instead of dropping them.
- Updated `src/tui.ts`:
  - downloader modal now blocks `Enter` downloads for incompatible file selections and shows an in-modal error.
- Updated `src/downloader-ui.ts`:
  - empty file message now reflects full GGUF list behavior (`No GGUF files found`) instead of compatibility-only wording.
- Updated tests:
  - `tests/downloader-state.test.ts` now asserts `Top Rated -> trendingScore`.
  - `tests/model-downloader.test.ts` now verifies oversized files are present but flagged incompatible.
    Validation:
- `npm test -- tests/downloader-state.test.ts tests/model-downloader.test.ts tests/downloader-ui.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 165 tests)
  Next:
- Add in-modal visual styling for incompatible file rows (for example a warning glyph/color) to make blocked selections obvious before pressing Enter.
