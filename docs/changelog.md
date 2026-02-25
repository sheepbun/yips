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
- Exchange continuity log index at `docs/progress-log.md` with per-entry files under `docs/progress-log/YYYY/MM/DD/`
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
- `src/conductor.ts` orchestration module for assistant response chaining, tool-call execution rounds, and depth-capped loop control
- `src/tui-input-routing.ts` deterministic input routing helpers for confirmation decisions and VT escape handling
- New tests:
  - `tests/conductor.test.ts` for tool-chaining and max-depth behavior
  - `tests/tui-input-routing.test.ts` for confirm and VT routing behavior
- Milestone 2 hard reboot architecture:
  - added `src/agent/core/contracts.ts` as the unified action/turn contract surface
  - added `src/agent/core/action-runner.ts` for normalized tool/skill/subagent dispatch with fallback warnings
  - added `src/agent/core/turn-engine.ts` deterministic action-loop state machine (`runAgentTurn`)
  - added strict envelope parsing in `src/agent/protocol/agent-envelope.ts` (`yips-agent` primary, `yips-tools` compatibility)
  - added protocol instruction composition in `src/agent/protocol/system-prompt.ts` so llama requests always include explicit `yips-agent` action-envelope guidance
  - added first-class risk policy in `src/agent/tools/action-risk-policy.ts` (`none|confirm|deny`, reason tags, explicit session-root checks)
  - added new coverage in `tests/agent/core/turn-engine.test.ts`, `tests/agent/protocol/agent-envelope.test.ts`, and `tests/agent/tools/action-risk-policy.test.ts`
- Tool-call protocol documentation:
  - added `docs/guides/tool-calls.md` with operational flow, schema/contracts, safety semantics, and troubleshooting guidance
  - synchronized `docs/architecture.md` with current `yips-agent`/turn-engine implementation (removed legacy tag-based protocol description as current behavior)
- Conductor automatic-pivot guidance for repeated tool-failure rounds (injects recovery system context after consecutive all-failed tool rounds)
- Subagent delegation system:
  - `subagent_calls` support in `yips-tools` protocol parsing
  - Conductor delegation hook for subagent lifecycle execution and result injection
  - TUI runtime subagent runner with scoped history, per-call round caps, and optional allowed-tool filtering
  - new delegation tests in `tests/conductor.test.ts` and parser coverage in `tests/tool-protocol.test.ts`
- Hardware-aware startup model auto-selection:
  - startup now selects a local runnable model when config model is unset (`default`)
  - selection prefers the largest model that fits detected VRAM, with fallback to the largest runnable RAM+VRAM-fit model
  - selected model is persisted to config before llama startup reset
- Long-term memory system:
  - added `src/memory-store.ts` with save/list/read APIs for markdown memories under `~/.yips/memories`
  - implemented `/memorize` command (`/memorize <fact>`, `/memorize list [limit]`, `/memorize read <id>`)
  - added tests in `tests/memory-store.test.ts` and expanded `/memorize` command coverage in `tests/commands.test.ts`
- Hooks system:
  - added `src/hooks.ts` hook runner with shell command execution, JSON stdin payloads, `YIPS_HOOK_*` env vars, timeout handling, and soft-fail status reporting
  - added config-level hook support in `AppConfig.hooks` for lifecycle hook commands and per-hook timeouts
  - integrated `on-session-start`, `on-session-end`, and `on-file-write` hook points
  - added tests in `tests/hooks.test.ts`, expanded `tests/tool-executor.test.ts`, and added run-once guard coverage in `tests/tui-startup-reset.test.ts`
- Milestone 3 skills runtime:
  - added `skill_calls` support to the `yips-tools` protocol and conductor loop (`search`, `fetch`, `build`, `todos`, `virtual_terminal`)
  - added `src/skills.ts` skill executor with DuckDuckGo search, URL fetch/text extraction, build command execution, TODO scanning, and VT command execution
  - wired skill execution into TUI conductor and subagent flows
  - implemented user-facing `/search` and `/fetch` command handlers
  - added coverage in `tests/skills.test.ts`, `tests/tool-protocol.test.ts`, `tests/conductor.test.ts`, and `tests/commands.test.ts`
- Milestone 4 gateway core bootstrap:
  - added `src/gateway/core.ts` dispatch orchestration for validation, auth allowlists, rate limiting, session management, and handler delegation
  - added `src/gateway/message-router.ts`, `src/gateway/session-manager.ts`, `src/gateway/rate-limiter.ts`, and `src/gateway/types.ts`
  - added coverage in `tests/gateway/core.test.ts`, `tests/gateway/message-router.test.ts`, `tests/gateway/session-manager.test.ts`, and `tests/gateway/rate-limiter.test.ts`
- Milestone 4 Telegram adapter bootstrap:
  - added `src/gateway/adapters/types.ts` adapter contract for platform inbound/outbound translation
  - added `src/gateway/adapters/telegram.ts` Telegram Bot API adapter for webhook/poll update parsing and `sendMessage` request formatting
  - added coverage in `tests/gateway/adapters/telegram.test.ts`
- Milestone 4 WhatsApp adapter bootstrap:
  - added `src/gateway/adapters/whatsapp.ts` WhatsApp Cloud API adapter for webhook message parsing and Graph API `/messages` request formatting
  - added coverage in `tests/gateway/adapters/whatsapp.test.ts`
- Milestone 4 Discord adapter + runtime bootstrap:
  - added `src/gateway/adapters/discord.ts` Discord Bot API adapter for inbound message normalization and outbound request formatting
  - added outbound auto-chunking for Discord message length limits
  - added `src/gateway/runtime/discord-bot.ts` discord.js runtime loop wired into `GatewayCore.dispatch(...)`
  - added `src/gateway/runtime/discord-main.ts` executable runtime entrypoint with env-based token/allowlist config
  - added coverage in `tests/gateway/adapters/discord.test.ts` and `tests/gateway/runtime/discord-bot.test.ts`
- Milestone 4 authentication hardening:
  - added `src/gateway/auth-policy.ts` for sender allowlist checks and optional `/auth <passphrase>` session bootstrap
  - `GatewayCore` now supports optional passphrase auth with explicit unauthorized responses and authenticated handshake status
  - Discord runtime now emits outbound denial/handshake replies when `dispatch(...)` returns a response payload for non-`ok` statuses
  - Discord main runtime now supports optional `YIPS_GATEWAY_PASSPHRASE`
  - added coverage in `tests/gateway/auth-policy.test.ts`, expanded `tests/gateway/core.test.ts`, and expanded `tests/gateway/runtime/discord-bot.test.ts`
- Milestone 4 platform-specific outbound formatting:
  - added `src/gateway/adapters/formatting.ts` shared normalization helpers (line endings, markdown stripping, mention sanitization, chunking)
  - Discord, Telegram, and WhatsApp adapters now normalize outbound text with conservative mention-safe plain-text policy
  - Telegram and WhatsApp adapters now support outbound multi-request chunking parity with per-platform caps
  - added coverage in `tests/gateway/adapters/formatting.test.ts` and expanded gateway adapter tests for chunking/sanitization
- Milestone 4 headless Conductor mode:
  - added `src/gateway/headless-conductor.ts` to run Conductor turns without TUI for gateway sessions
  - wired `src/gateway/runtime/discord-main.ts` to use the headless handler instead of echo responses
  - gateway headless runtime uses llama.cpp-only assistant turns, final-answer response output, and auto-deny safety behavior for risky tool calls
  - gateway sessions now persist transcript snapshots via existing session-store APIs
  - added coverage in `tests/gateway/headless-conductor.test.ts`
- Gateway backend policy formalization:
  - added `src/gateway/runtime/backend-policy.ts` for `YIPS_GATEWAY_BACKEND` resolution with default `llamacpp`
  - `src/gateway/runtime/discord-main.ts` now resolves and validates gateway backend at startup and passes it to headless runtime
  - `src/gateway/headless-conductor.ts` now supports explicit gateway backend override while retaining defensive unsupported-backend guardrails
  - added coverage in `tests/gateway/runtime/backend-policy.test.ts` and expanded `tests/gateway/headless-conductor.test.ts`
- `/update` command and npm registry version-check path:
  - added `src/app/update-check.ts` for npm latest-version checks and semver comparison
  - added guided update command output (`npm install -g yips@latest`, source-install refresh path, `yips.dev` docs hub)
  - added coverage in `tests/app/update-check.test.ts` and expanded command coverage in `tests/agent/commands/commands.test.ts`
- Release workflow automation:
  - added `.github/workflows/release.yml` for tag-driven validation, npm publish, and GitHub release creation
- Background Discord gateway runtime:
  - added `src/gateway/background.ts` to run Discord gateway in-process during normal Yips app sessions
  - app startup now auto-starts/stops Discord gateway lifecycle around TUI/REPL runtime
  - Discord token resolution now supports env-first fallback to `config.channels.discord.botToken` for both app background mode and `gateway:discord`
  - added coverage in `tests/gateway/background.test.ts`
- Telegram runtime + background startup:
  - added `src/gateway/runtime/telegram-bot.ts` long-poll runtime loop (`getUpdates`) wired into `GatewayCore`
  - added `src/gateway/runtime/telegram-main.ts` executable runtime entrypoint and `npm run gateway:telegram` script
  - Telegram runtime now emits best-effort UX signals during processing (`sendChatAction` typing heartbeat + `setMessageReaction` 👀 attempt)
  - Telegram runtime now clears inbound 👀 reaction after at least one successful outbound send
  - background launcher now auto-starts Telegram runtime when token is configured, including concurrent Discord+Telegram startup
  - added coverage in `tests/gateway/runtime/telegram-bot.test.ts` and expanded `tests/gateway/background.test.ts`

### Changed

- Refactored the TypeScript rewrite to a domain-first tree:
  - moved flat `src/` modules into `src/app`, `src/agent`, `src/config`, `src/llm`, `src/models`, `src/types`, and `src/ui`
  - reorganized `tests/` to mirror the new source domains for easier source-to-test navigation
  - introduced runtime-safe Node `#imports` aliases (with matching TypeScript `paths`) for cross-domain imports
  - added focused TUI helper modules in `src/ui/tui` (`constants`, `runtime-utils`, `history`, `layout`, `autocomplete`)
  - updated launcher/runtime entry paths to `src/app/index.ts` and `dist/app/index.js`
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
- `src/tui.ts` now delegates chat/tool orchestration to the Conductor module and uses extracted confirm/VT routing helpers, reducing inline control-flow complexity without changing user-visible behavior
- Milestone 2 runtime internals now route through the new action-engine stack:
  - `src/agent/conductor.ts` is now a compatibility shim delegating to `runAgentTurn(...)`
  - `src/ui/tui/runtime-core.ts` and `src/gateway/headless-conductor.ts` now consume the new risk-policy assessment path
  - legacy `tool-protocol` remains as a compatibility shim over `agent-envelope`
- TUI action rendering now hides raw `yips-agent` envelope blocks during streaming and renders styled action call/result boxes for tool, skill, and subagent events (compact by default, richer detail in verbose mode)
- TUI action/event rendering now uses compact bullet-style lines instead of bordered boxes:
  - tool calls render with tool-specific labels (for example `Bash(...)`, `Read(...)`, `Search(...)`)
  - action results render as concise `⎿` summaries in normal mode
  - verbose mode expands inline details/metadata and shows action IDs
  - legacy verbose debug tag lines (`[tool]`, `[tool-result]`, `[skill]`, `[subagent]`) were removed
- Milestone 2 recovery behavior now includes automatic pivoting when tool executions fail repeatedly, so the assistant is steered toward alternate approaches instead of repeating failing calls
- Milestone 2 now includes Conductor-managed subagent delegation, scoped context execution, and lifecycle result chaining
- Milestone 3 hardware detection now includes GPU/VRAM-aware startup model auto-selection from local GGUF inventory
- Tool executor now runs `on-file-write` hooks after successful `write_file`/`edit_file`; hook failures are surfaced as warnings in tool output while preserving successful file operations
- Added runtime import alias mapping for `#gateway/*` in `package.json` and `tsconfig.json`
- Gateway adapter contract now supports outbound multi-request payloads for platforms that require chunked sends
- Distribution metadata and CLI packaging:
  - `package.json` now includes `bin`, publish `files`, `homepage`, `repository`, and issue tracker metadata
  - `src/app/index.ts` now includes a Node shebang for npm global-bin execution
- Scoped npm release pivot:
  - package identity updated to `@sheepbun/yips` with version bumped to `0.1.1`
  - `/update` now resolves the npm package name from local `package.json` metadata by default
  - `/update` guidance now prefers scoped install commands and includes legacy unscoped caveats
- Removed stale duplicate legacy test file `tests/tui-resize-render.test.ts` to restore full-suite baseline (`tests/ui/tui/tui-resize-render.test.ts` remains canonical)

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
