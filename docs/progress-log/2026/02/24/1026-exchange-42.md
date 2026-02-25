## 2026-02-24 10:26 MST — Exchange 42

Summary: Restored the Yips model downloader in the TypeScript project by porting Hugging Face GGUF list/files/download flows and wiring `/download` + `/dl`.
Changed:

- Added `src/model-downloader.ts`:
  - `listGgufModels(...)` for Hugging Face GGUF discovery
  - `listModelFiles(...)` for GGUF file enumeration per repo
  - `downloadModelFile(...)` for streaming downloads to local models directory
  - renderer helpers for model/file output text
  - default models directory resolution (`YIPS_MODELS_DIR` override, else `~/.yips/models`)
- Updated `src/commands.ts`:
  - command dispatch now supports async handlers
  - implemented `/download` and `/dl` handlers with:
    - top models view (`/download`)
    - search (`/download search <query>`)
    - repo file listing (`/download files <repo_id>`)
    - direct download (`/download <repo_id> <file_path.gguf>`)
- Updated `src/tui.ts`:
  - command execution path now awaits async command dispatch
- Added tests in `tests/model-downloader.test.ts`:
  - model listing, file listing, download write path, output rendering
- Updated `tests/commands.test.ts`:
  - adapted for async dispatch
  - added `/download` and `/dl` regression coverage
- Updated docs:
  - `docs/guides/slash-commands.md` downloader usage section
  - `docs/changelog.md` Unreleased entries for downloader restoration
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (15 files, 156 tests)
  Next:
- Add an interactive downloader UI layer in Ink (model list + file picker) on top of the restored backend downloader functions.
- Add optional download progress reporting in TUI output for long GGUF transfers.
