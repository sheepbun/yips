## 2026-02-23 20:12 MST — Exchange 56

Summary: Restored `/models` Yips Model Manager from yips-cli into the TypeScript Ink TUI with local model list/switch/delete, downloader handoff, nickname persistence, and command wiring parity.
Changed:

- Added model manager implementation modules:
  - `src/model-manager.ts`: recursive local GGUF discovery from `YIPS_MODELS_DIR` or `~/.yips/models`, model metadata shaping, local matching helpers, filtering helpers, and safe local model delete with empty-directory pruning.
  - `src/model-manager-state.ts`: model-manager UI state machine (loading/error/idle, selection/scroll, search filtering, remove/select helpers).
  - `src/model-manager-ui.ts`: bordered gradient Model Manager renderer with yips-cli-style column layout, selected-row highlights, current-model marker, RAM/VRAM header, and action footer.
- Extended runtime/config types and persistence:
  - `src/types.ts`: added `nicknames` to `AppConfig`.
  - `src/config.ts`: added nickname normalization plus `saveConfig()` and `updateConfig()` persistence helpers.
- Updated slash-command behavior in `src/commands.ts`:
  - `/model` without args now opens Model Manager UI mode.
  - `/model <name>` now attempts local exact/partial model matching first, then falls back to free-form assignment.
  - `/models` now implemented as UI-open command (UI-only alias).
  - `/nick <target> <nickname>` now implemented and persisted to `.yips_config.json`.
- Integrated model-manager mode in `src/tui.ts`:
  - added `uiMode: chat|downloader|model-manager` and `modelManager` runtime state.
  - wired `/model` and `/models` `uiAction` handling to open manager mode.
  - manager mode uses Prompt Composer text as live local search.
  - keyboard behavior in manager mode: select (`Enter`), close (`Esc`), move (`↑/↓`), delete local model (`Del`), and downloader handoff via `t` when search is empty.
  - selected model switch now persists config and logs in output.
- Added/updated tests:
  - new `tests/model-manager.test.ts`.
  - new `tests/model-manager-state.test.ts`.
  - new `tests/model-manager-ui.test.ts`.
  - updated `tests/commands.test.ts` for `/model` UI-open behavior, `/models`, local matching, and `/nick` persistence.
  - updated `tests/config.test.ts` for `nicknames` plus persistence helper coverage.
- Updated docs:
  - `docs/guides/slash-commands.md` command table for `/model`, `/models`, and `/nick` behavior.
  - `docs/roadmap.md` marked Model Manager and configuration file support as completed.
  - `docs/changelog.md` updated with restored Model Manager and command/persistence changes.
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (20 files, 192 tests)
- `npm run lint` — clean
- `npm run format:check` — still reports pre-existing formatting drift in unrelated files (unchanged by this exchange)
  Next:
- Add focused TUI integration coverage for model-manager mode transitions (`/model` open, in-mode search/select/delete, Esc close, and manager -> downloader handoff).
- Revisit manager-mode `t` key handling if strict single-key semantics are needed independently of typed search input.
