## 2026-02-24 11:20 MST — Exchange 46

Summary: Implemented downloader UX/behavior fixes from the bug list: inline rendering, prompt-box search, HF 400 recovery, border/style parity, and Esc handling.
Changed:

- Updated `src/tui.ts`:
  - downloader no longer replaces the whole screen; it renders inline in the output stack while title/chat/prompt remain visible
  - prompt composer is now the downloader search input source in downloader mode
  - added debounced search sync from prompt composer to downloader state/API calls
  - entering downloader seeds composer text from existing downloader search query
  - Esc in model-list view now reliably closes downloader back to chat mode
  - downloader prompt status now shows `model-downloader · search`
- Updated `src/model-downloader.ts`:
  - fixed model-list request shape by sending repeated HF `expand` params instead of a CSV value
  - added automatic fallback retry without `expand` params on HTTP 400/422 responses
- Updated `src/input-engine.ts`:
  - added lone-ESC handling to emit `cancel` (so Esc works consistently in downloader mode)
- Updated `src/hardware.ts` and `src/downloader-state.ts`:
  - restored downloader telemetry with disk-free tracking (`diskFreeGb`) alongside RAM/VRAM totals
- Updated `src/downloader-ui.ts`:
  - fixed border alignment issues by using ANSI-aware visible-width calculations
  - restored active tab highlight styling (pink→yellow gradient) with dim inactive tabs
  - removed in-panel search row to defer search input to the shared prompt box
  - updated footer copy from `Esc Quit` to `Esc Close` in model-list view
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 167 tests)
  Next:
- Add downloader-specific integration tests that assert prompt input updates search results while the inline panel remains visible with chat history.
