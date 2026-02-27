# Yips Roadmap

## Architecture

```
  yips-tui ─────┐
                 │  Unix Socket IPC
  yips-cli ─────┼──── yips-daemon ──── llama.cpp (HTTP)
                 │         │
  yips-gateway ─┘         └── skill scripts (subprocess)
```

Four binaries, one shared library core.

## Phase Summary

| Phase | Name | Status | Deliverable |
|-------|------|--------|-------------|
| 0 | [Foundation](phase-0-foundation.md) | In Progress | `cargo test` passes, can chat with llama.cpp |
| 1 | [Agent Engine](phase-1-agent-engine.md) | Not Started | Multi-round agentic conversations |
| 2 | [Daemon + CLI (MVP)](phase-2-daemon-cli.md) | Not Started | `yips-daemon &` + `yips-cli ask "..."` works |
| 3A | [TUI](phase-3a-tui.md) | In Progress | Interactive ratatui coding assistant |
| 3B | [Gateway](phase-3b-gateway.md) | Not Started | Discord/Telegram bots respond with AI |
| 4 | [Skills](phase-4-skills.md) | Not Started | External scripts invokable from conversation |
| 5 | [Subagents + Polish](phase-5-subagents.md) | Not Started | Full conductor/subagent pattern |
| 6 | [Packaging](phase-6-packaging.md) | Not Started | Static binaries, systemd units |
