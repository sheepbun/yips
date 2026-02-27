# Yips Roadmap

Last rebaselined: 2026-02-27
Last verified: 2026-02-27

Current priority: Phase 4 Skills

Evidence: [Roadmap Evidence Matrix](evidence-matrix.md)

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
| 0 | [Foundation](phase-0-foundation.md) | Complete | `cargo test` passes, can chat with llama.cpp |
| 1 | [Agent Engine](phase-1-agent-engine.md) | Complete | Multi-round agentic conversations |
| 2 | [Daemon + CLI (MVP)](phase-2-daemon-cli.md) | Complete | `yips-daemon &` + `yips-cli ask "..."` works |
| 3A | [TUI](phase-3a-tui.md) | Complete | Interactive ratatui coding assistant |
| 3B | [Gateway](phase-3b-gateway.md) | Complete | Discord + Telegram adapters wired through shared runtime; maintainer CI trigger guidance: [When to Run in CI (Manual Hardening)](phase-3b-gateway.md#when-to-run-in-ci-manual-hardening) |
| 4 | [Skills](phase-4-skills.md) | In Progress | External scripts invokable from conversation |
| 5 | [Subagents + Polish](phase-5-subagents.md) | Not Started | Full conductor/subagent pattern |
| 6 | [Packaging](phase-6-packaging.md) | Not Started | Static binaries, systemd units |
