## 2026-02-24 10:45 MST — Exchange 44

Summary: Implemented full modal-style Yips Model Downloader restoration in the Ink TUI, with modal-first `/download` behavior and direct Hugging Face URL downloads.
Changed:

- Added `src/hardware.ts`:
  - RAM/VRAM detection (NVIDIA `nvidia-smi`, AMD sysfs fallback)
  - cached combined memory specs (`ramGb`, `vramGb`, `totalMemoryGb`)
- Expanded `src/model-downloader.ts`:
  - added direct URL parsing/validation (`parseHfDownloadUrl`, `isHfDownloadUrl`)
  - added quantization extraction for file rows
  - added suitability metadata (`canRun`, `reason`) for models/files
  - added RAM+VRAM filtering of oversized entries
  - download now accepts explicit revision from URL path
- Added `src/downloader-state.ts`:
  - downloader tab/view state, selection/scroll helpers, loading/error helpers
- Added `src/downloader-ui.ts`:
  - full-screen modal renderer with gradient frame/title, tabs, search row, model list, file list, and footer key hints
- Updated `src/commands.ts`:
  - `CommandResult` now supports `uiAction`
  - `/download` and `/dl` now open interactive modal with no args
  - `/download <hf_url>` supports direct download from `hf.co`/`huggingface.co`
  - removed old `/download search|files|<repo> <file>` command paths
- Updated `src/tui.ts`:
  - added modal mode routing (`uiMode: chat|downloader`)
  - downloader keyboard handling on raw input (search typing, tab cycling via arrows, list/file selection, esc back/close)
  - async model/file loading and in-modal download flow integrated with output confirmation
  - dedicated downloader render path that temporarily replaces chat/title/prompt layout while modal is active
- Added/updated tests:
  - `tests/model-downloader.test.ts` (URL parsing, filtering, quant metadata, download path)
  - `tests/commands.test.ts` (modal open action + direct URL behavior)
  - new `tests/downloader-state.test.ts`
  - new `tests/downloader-ui.test.ts`
- Updated docs:
  - `docs/guides/slash-commands.md` for modal-first `/download` + direct URL syntax
  - `docs/changelog.md` Unreleased entries for modal restoration and memory-based filtering
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (17 files, 165 tests)
  Next:
- Add in-modal download progress feedback (byte/percent updates) during large GGUF transfers.
- Add an integration test that exercises TUI mode-switch `/download` -> modal render -> escape back to chat.
