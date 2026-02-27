# Agent Instructions for Yips

This document provides universal instructions for any AI coding tool working on Yips.

## High Priority Session Handoff
- After finishing implementation work in a session, always include a ready-to-run “next session prompt” in the final response.
- The prompt must summarize completed work, current state, open items, and the first concrete step for the next session.

## Project Structure
Rust workspace with 9 crates under `crates/`. See `CLAUDE.md` for the full architecture overview.

## Code Style
- Rust 2021 edition, stable toolchain
- Use `thiserror` for library error types, `anyhow` for binary error handling
- Derive `Debug, Clone, Serialize, Deserialize` on all public types where appropriate
- Use `tracing` for logging (not `println!` or `log`)
- Async code uses `tokio` runtime
- Prefer explicit error types over `String` errors
- Keep module boundaries clear with descriptive file names
- Write doc comments on all public APIs

## Testing
- Unit tests in `#[cfg(test)]` modules within source files
- Integration tests in `tests/` directories within each crate
- Use `tempfile` for filesystem tests
- Use `tokio::test` for async tests

## Key Patterns
- IPC protocol: 4-byte BE length prefix + JSON payload over Unix sockets
- Tool interface: `Tool` trait with `execute(args: Value) -> Result<ToolOutput>`
- Skills: External executables with JSON stdin/stdout protocol
- Agent: ReAct loop with configurable max rounds (default 6) and failure pivot threshold (2)

## Dependencies
All shared dependencies are declared in the workspace `Cargo.toml` under `[workspace.dependencies]`.

## Configuration
TOML config at `~/.config/yips/config.toml`. See `yips-core/src/config.rs` for the schema.
