# Changelog

All notable changes to Yips will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/) once versioned releases begin.

## [Unreleased]

### Added

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

### Changed

- `docs/guides/getting-started.md` now reflects runnable TUI commands and llama.cpp chat behavior
- `docs/contributing.md` updated with implemented toolchain (npm, Vitest, ESLint, Prettier)
- `docs/roadmap.md` and `docs/stack.md` updated with Milestone 0 decisions and completed items
- `src/index.ts` updated to launch TUI by default, with REPL fallback
- TUI framework migrated from terminal-kit to Ink (see `docs/stack.md`)
- Truecolor markup pipeline fixed to terminal-kit syntax (`^[#rrggbb]...^:`), resolving broken literal color output
- `src/tui.ts` now sends messages to llama.cpp, streams token output in-place, tracks in-memory conversation history, and retries failed streams once in non-stream mode
- Config schema now includes `llamaBaseUrl` and `model`, with optional `YIPS_LLAMA_BASE_URL` and `YIPS_MODEL` overrides
- Slash commands: `/model` now updates the active runtime model and `/new` aliases `/clear`

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
- `/backend` command for hot-switching between llama.cpp, LM Studio, and Claude CLI
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

- LM Studio 400 Bad Request errors resolved with improved error handling

### 2026-02-02

#### Added

- Web search via DuckDuckGo skill for current events and time-sensitive queries
- "Truth via Tools" principle: agent prioritizes search results and tool output over internal training data

#### Changed

- AGENT.md updated to mandate SEARCH skill for current events queries to prevent outdated hallucinations
- SEARCH.py updated with system prompt injection to force prioritization of search results

---

> Last updated: 2026-02-23
