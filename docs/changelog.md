# Changelog

All notable changes to Yips will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/) once versioned releases begin.

## [Unreleased]

### Added

- `install.sh` automated local runtime setup:
  - installs missing system prerequisites via supported package managers
  - supports optional CUDA toolkit install via `./install.sh --cuda`
  - on Arch, uses full-upgrade `pacman -Syu` installs to avoid partial-upgrade breakage
  - adds Arch node-runtime self-heal (`nodejs npm simdjson`) when shared-library linkage is broken
  - installs a `~/.local/bin/yips` launcher and updates env so `yips` can be run from any directory
  - launcher now defaults to source mode and only uses `dist` when `YIPS_USE_DIST=1`
  - clones/updates and builds `llama.cpp` (`llama-server`) with CUDA-first + CPU fallback
  - writes `~/.yips/env.sh` (`LLAMA_SERVER_PATH`, `YIPS_LLAMA_SERVER_PATH`, `YIPS_LLAMA_MODELS_DIR`)
  - creates/patches `.yips_config.json` lifecycle defaults without clobbering existing user values
  - guides users to `/download` or `/model` when no local GGUF model is present
- Milestone 0 TypeScript scaffold (`package.json`, `tsconfig`, `src/`, `tests/`)
- Bootstrap REPL loop with `/help`, `/exit`, and `/quit`
- JSON config loader with safe defaults and malformed-config fallback handling
- CI workflow for install, typecheck, test, and formatting checks
- Initial ESLint + Prettier project configuration
- Exchange continuity log at `docs/progress-log.md`
- Ink-based TUI: conversation pane, prompt composer, and command-aware multiline input
- Color system (`src/colors.ts`): gradient palette, horizontal/diagonal gradients, truecolor markup
- Responsive title box (`src/title-box.ts`): ASCII YIPS logo, 4 layout modes (full/single/compact/minimal), gradient borders
- Message formatting (`src/messages.ts`): user, assistant, error, warning, success, dim message styles
- Pulsing spinner (`src/spinner.ts`): braille frames, sine-wave color oscillation, elapsed timer
- Command registry (`src/commands.ts`): register/dispatch pattern, built-in `/help`, `/exit`, `/quit`, `/clear`, `/model`, `/stream`, `/verbose`
- TTY detection: TUI launches for interactive terminals, REPL fallback for pipes and `--no-tui`
- `src/llama-client.ts`: OpenAI-compatible llama.cpp client for non-streaming and SSE streaming chat completions
- New backend tests in `tests/llama-client.test.ts` covering request payloads, streaming deltas, and failure paths
- `src/model-downloader.ts`: Hugging Face GGUF model discovery, file listing, and downloader to local models directory
- `/download` and `/dl` command handlers implemented in the TypeScript rewrite
- `src/hardware.ts`: runtime RAM/VRAM detection for model suitability filtering
- Interactive downloader modules: `src/downloader-state.ts` and `src/downloader-ui.ts`
- New tests for downloader modal state/rendering (`tests/downloader-state.test.ts`, `tests/downloader-ui.test.ts`)
- Downloader input now reuses the shared Prompt Box as live search in downloader mode, while keeping title/chat/prompt visible
- Downloader telemetry now includes `RAM+VRAM` and disk-free availability
- Input engine now treats lone `Esc` as cancel so downloader close/back works reliably
- Downloader tabs and selected list rows now use highlighted gradient backgrounds for closer yips-cli visual parity
- Downloader now preloads non-active tabs in the background and serves tab switches from in-memory cache when available
- Interactive Model Manager restoration (`src/model-manager.ts`, `src/model-manager-state.ts`, `src/model-manager-ui.ts`) with local model list/search/select/delete and downloader jump
- `/models` command implementation and `/nick` command implementation with config persistence
- Config persistence APIs in `src/config.ts` (`saveConfig`, `updateConfig`) and `nicknames` support in `AppConfig`
- Model Manager tests (`tests/model-manager.test.ts`, `tests/model-manager-state.test.ts`, `tests/model-manager-ui.test.ts`)
- Session persistence module (`src/session-store.ts`) with save/list/load support for markdown session files in `~/.yips/memory`
- `/sessions` command implementation in the TypeScript rewrite (interactive session browser mode in TUI)
- `/tokens` command implementation with `auto` and manual modes for title-box token max control

### Changed

- llama.cpp startup now performs a localhost-only fresh-session reset before TUI launch:
  - stops Yips-managed llama-server state and starts a new server/model load on startup
  - fails startup immediately with actionable diagnostics if reset/start fails
  - skips reset for non-local endpoints to avoid disrupting remote/shared backends
- Config persistence now supports canonical path pinning via `YIPS_CONFIG_PATH`:
  - `loadConfig`/`saveConfig` use `YIPS_CONFIG_PATH` when set (default only)
  - default-load fallback still reads legacy `.yips_config.json` when env path is absent/unreadable
  - installer now exports `YIPS_CONFIG_PATH=~/.yips/config.json` in `~/.yips/env.sh`
- `docs/guides/getting-started.md` now reflects runnable TUI commands and llama.cpp chat behavior
- `docs/contributing.md` updated with implemented toolchain (npm, Vitest, ESLint, Prettier)
- `docs/roadmap.md` and `docs/stack.md` updated with Milestone 0 decisions and completed items
- `src/index.ts` updated to launch TUI by default, with REPL fallback
- TUI framework migrated from terminal-kit to Ink (see `docs/stack.md`)
- `YIPS_DEBUG_KEYS=1` output now warns when terminal input is plain CR submit (likely no distinguishable Ctrl+Enter encoding)
- `docs/guides/getting-started.md` now includes multiline key troubleshooting and Alacritty Ctrl+Enter mapping guidance
- Alacritty troubleshooting now includes an alternate Ctrl+Enter fallback mapping (`\u001b[13;5~`) when CSI-u mapping is not effective
- Truecolor markup pipeline fixed to terminal-kit syntax (`^[#rrggbb]...^:`), resolving broken literal color output
- `src/tui.ts` now sends messages to llama.cpp, streams token output in-place, tracks in-memory conversation history, and retries failed streams once in non-stream mode
- Config schema now includes `llamaBaseUrl` and `model`, with optional `YIPS_LLAMA_BASE_URL` and `YIPS_MODEL` overrides
- Slash commands: `/model` now updates the active runtime model and `/new` aliases `/clear`
- Command dispatch now supports async handlers so network-backed commands (like `/download`) can run directly in the TUI flow
- `/download` is now modal-first in TUI: no-arg opens interactive downloader, while `/download <hf_url>` supports direct Hugging Face URL downloads
- Downloader lists/files are filtered by combined `RAM + VRAM` suitability and render in a dedicated full-screen modal-style UI
- Downloader parity pass: `Top Rated` now maps to HF `trendingScore`, compatibility uses `RAM+VRAM * 1.2`, oversized files remain visible with blocked download selection
- Downloader is now rendered inline with existing chat output instead of replacing the full screen
- Downloader tabs restored to yips-cli-like active gradient highlight style; border alignment fixed for ANSI-colored rows
- Hugging Face model fetch now uses valid repeated `expand` params and retries without expand on HTTP 400/422
- Downloader list row styling restored toward yips-cli parity with gradient-highlighted selected rows and compatibility status coloring
- `/model` behavior now opens Model Manager with no args, and with args performs local exact/partial matching before free-form fallback
- TUI now supports a dedicated `model-manager` UI mode with prompt-composer search input and persisted model selection
- Title box right column now renders real recent session activity and highlights selection while browsing `/sessions`
- TUI now auto-creates and updates session files after exchanges, derives session names from first user prompt, and restores history from selected sessions
- Title-box token usage now renders as `x.x/y.yk tks`, with auto max derived from RAM-after-model-load and manual override via `/tokens`
- Ink TUI chat scrollback now supports mouse wheel input (with `PgUp`/`PgDn` fallback), including terminal mouse-reporting enable/disable during app lifetime

## Legacy (yips-cli)

Changes from the Python CLI predecessor. These entries are reformatted from `yips-cli/CHANGELOG_YIPS.md`.

### 2026-02-05

#### Added

- Global slash command completer — autocompletion triggers anywhere in the input buffer, not just at the start
- Command autocompletion integrated into the Model Downloader search prompt
- Missing `/backend` and `/download` commands added to the built-in completion list

### 2026-02-03

#### Added

- llama.cpp integration with CUDA support as the primary backend
- Summarized thinking blocks displayed in a bulleted UI box
- `/backend` command for hot-switching between llama.cpp and Claude CLI
- Diagonal (top-left to bottom-right) gradient scan on thinking block for a dynamic aesthetic

#### Changed

- Thinking block styled with banana yellow to solid blue gradient and manual border rendering for alignment
- CLI spacing refined to eliminate redundant gaps between tool calls and ensure consistent padding before user prompts

#### Fixed

- Thinking process box border alignment corrected with symmetric internal padding and precise width calculations

### 2026-02-03

#### Changed

- Default model switched to Qwen-3 for better stability on 10GB VRAM hardware

#### Fixed

- Backend 400 Bad Request errors resolved with improved error handling

### 2026-02-02

#### Added

- Web search via DuckDuckGo skill for current events and time-sensitive queries
- "Truth via Tools" principle: agent prioritizes search results and tool output over internal training data

#### Changed

- AGENT.md updated to mandate SEARCH skill for current events queries to prevent outdated hallucinations
- SEARCH.py updated with system prompt injection to force prioritization of search results

---

> Last updated: 2026-02-25
