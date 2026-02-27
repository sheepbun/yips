# Yips - AI Agent System

## High Priority Session Handoff
- After finishing implementation work in a session, always include a ready-to-run “next session prompt” in the final response.
- The prompt must summarize completed work, current state, open items, and the first concrete step for the next session.

## Overview
Yips is a local-first AI agent with a microservices architecture built in Rust. It combines agentic coding capabilities with a multi-channel personal assistant gateway, powered by llama.cpp for local inference.

## Architecture
- **yips-core**: Shared types, config, IPC protocol, message types
- **yips-llm**: llama.cpp HTTP client (streaming SSE + non-streaming)
- **yips-tools**: Built-in tool implementations (read_file, write_file, edit_file, grep, run_command, list_dir)
- **yips-skills**: External skill discovery and subprocess execution
- **yips-agent**: Turn engine (ReAct loop), conductor, subagent orchestration
- **yips-daemon**: IPC server, session management, llama.cpp lifecycle
- **yips-tui**: ratatui terminal UI
- **yips-gateway**: Multi-channel bot daemon (Discord, Telegram)
- **yips-cli**: Thin pipe-friendly CLI

## Building
```bash
cargo build                    # Build all crates
cargo test                     # Run all tests
cargo run --bin yips-daemon    # Run the daemon
cargo run --bin yips           # Run the CLI
cargo run --bin yips-tui       # Run the TUI
```

## Project Conventions
- Libraries use `thiserror` for error types; binaries use `anyhow`
- All public APIs have doc comments
- Config lives at `~/.config/yips/config.toml`
- IPC uses length-prefixed JSON over Unix domain sockets at `$XDG_RUNTIME_DIR/yips/daemon.sock`
- Skills are external executables in `~/.config/yips/skills/` or `.yips/skills/`

## See Also
- `AGENTS.md` for universal agent instructions
- `docs/roadmap/` for implementation phases
- `docs/ipc-compatibility.md` for IPC migration and compatibility policy
- `docs/ipc-client-inventory.md` for external client verification and signoff
