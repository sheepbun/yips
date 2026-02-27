# Phase 2: Daemon + CLI (MVP)

## Goal
IPC server, daemon process, and CLI client. This is the minimum viable product.

## Dependencies
Phase 1

## Crates Touched
- `yips-daemon` (create)
- `yips-cli` (create)

## Tasks
- [x] Implement IPC server accepting Unix socket connections
- [x] Implement session management (create, list, resume)
- [x] Implement llama.cpp lifecycle management (health check, optional auto-start)
- [x] Implement CLI with `ask`, `sessions`, `status` subcommands
- [x] Wire daemon to agent engine for end-to-end flow

## Key Types
- `DaemonServer`, `Session`, `SessionManager`
- CLI subcommands via clap

## Deliverable
`yips-daemon &` + `yips ask "list the files in this directory"` returns correct output.

## Status
In Progress
