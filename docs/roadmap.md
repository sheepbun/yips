# Roadmap

## Milestone 0: Foundation

Project scaffolding and core decisions.

- [x] Initialize TypeScript project with strict mode
- [x] Decide on config format (see [Decision Log](#decision-log))
- [x] Decide on TUI framework (see [Decision Log](#decision-log))
- [x] Basic REPL loop (read input → echo → exit)
- [x] Project directory structure (`src/`, `tests/`, `docs/`)
- [x] CI setup (lint, type-check, test)

## Milestone 1: Core TUI

Terminal interface with LLM integration.

- [x] TUI layout: input area, response pane, status bar
- [x] llama.cpp integration: send requests and parse OpenAI-compatible responses
- [x] Streaming display: token-by-token rendering
- [x] Conversation history: in-memory message list and context assembly
- [x] Slash command system: parse `/command args`, dispatch to handlers
- [x] Built-in commands: `/exit`, `/clear`, `/model`, `/stream`, `/verbose`, `/setup`
- [x] Loading indicators and error display

## Milestone 2: Agent System

Autonomous tool use and multi-agent architecture.

- [x] Tool protocol: structured tool calls (replacing text-tag parsing)
- [x] File operations: read, write, edit with diff preview
- [x] Shell command execution with safety guardrails
- [x] Destructive command detection and confirmation flow
- [x] Working zone enforcement
- [x] CODE.md loading and context injection
- [x] Conductor agent: context assembly, tool dispatch, response chaining
- [x] Subagent system: delegation, scoped context, lifecycle management
- [x] Error recovery and automatic pivoting

## Milestone 3: Developer Experience

Features that make daily use productive.

- [x] Model Manager: list, switch, download models
- [x] Hardware detection: GPU/VRAM-aware model selection
- [x] Session management: save, list, load, rename sessions
- [x] Memory system: save/read/list conversation memories
- [x] Hooks: user-defined scripts at lifecycle points
- [x] ~~MCP client: server registration, tool discovery, context injection~~ (skipped by product decision)
- [x] Skills: search, fetch, build, todos, virtual terminal
- [x] Tab autocompletion for slash commands
- [x] Configuration file support (format TBD)

## Milestone 4: Gateway _(planned)_

Self-hosted messaging platform bridge.

- [x] Gateway core: message routing, session management, rate limiting
- [x] WhatsApp adapter (WhatsApp Business API)
- [x] Telegram adapter (Bot API)
- [x] Discord adapter (Bot SDK)
- [x] Authentication and access control
- [x] Platform-specific message formatting
- [x] Headless Conductor mode (no TUI, API-driven)

## Milestone 5: Distribution _(planned)_

Packaging and installation.

- [x] Distribution format decision (npm package + `install.sh`; Homebrew/binary deferred)
- [x] Install script (single-command setup)
- [x] Auto-update mechanism (notify + guided update commands via `/update`)
- [x] llama.cpp bundling or first-run download (first-run setup flow via `install.sh` + `/download`)
- [x] Platform support: Linux, macOS, Windows (WSL2)

## Decision Log

| Decision        | Status   | Choice                     | Alternatives Considered | Notes                                                                             |
| --------------- | -------- | -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| Language        | Decided  | TypeScript (strict mode)   | Rust, Go, Python        | Type safety + ecosystem; Rust considered too slow for iteration                   |
| Runtime         | Decided  | Node.js                    | Deno, Bun               | Broadest ecosystem support; Bun may be revisited                                  |
| LLM backend     | Decided  | llama.cpp (primary)        | Ollama                  | Direct control over model lifecycle; OpenAI-compatible API                        |
| TUI framework   | Decided  | Ink                        | terminal-kit, blessed   | React component model, portable input handling, and maintainable render lifecycle |
| Config format   | Decided  | JSON (`.yips_config.json`) | TOML, YAML              | Chosen for zero dependencies during bootstrap; comments may be revisited later    |
| MCP integration | Rejected | Not pursuing MCP client    | MCP client architecture | Explicitly removed from roadmap by product direction (2026-02-25)                 |
| Distribution    | Decided  | npm package + `install.sh` | binary, Homebrew        | `yips.dev` acts as docs/download hub; guided updates via `/update`                |
| Package manager | Decided  | npm                        | pnpm, bun               | Pragmatic default for bootstrapping                                               |
| Formatter       | Decided  | Prettier                   | Biome                   | Widest editor/tooling compatibility                                               |
| Test framework  | Decided  | Vitest                     | Jest, node:test         | Fast TypeScript test loop and simple setup                                        |

---

> Last updated: 2026-02-25
