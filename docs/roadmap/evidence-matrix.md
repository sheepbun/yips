# Roadmap Evidence Matrix

Last verified: 2026-02-27

## Validation Commands

- `cargo test -q --workspace --exclude yips-daemon` (passes in this environment)
- `cargo test -q` (daemon IPC E2E fails in sandbox due socket bind permission on `crates/yips-daemon/tests/ipc_e2e.rs`)
- `cargo test -p yips-gateway --test gateway_signal_process -- --ignored` (passes locally; CI-equivalent command used in optional workflow)
- Maintainer note: run gateway signal coverage as manual hardening using Phase 3B guidance: [When to Run in CI (Manual Hardening)](phase-3b-gateway.md#when-to-run-in-ci-manual-hardening).

## Phase 0: Foundation

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Create Cargo workspace with all crate stubs | Done | `Cargo.toml`, `crates/` | Nine crates are present in workspace members. |
| Implement shared types | Done | `crates/yips-core/src/message.rs`, `crates/yips-core/src/tool.rs` | Core chat/tool types implemented and serialized. |
| Implement config loading from TOML | Done | `crates/yips-core/src/config.rs` | Default path and load APIs implemented. |
| Implement IPC protocol types and encoding | Done | `crates/yips-core/src/ipc.rs` | 4-byte BE length prefix + JSON roundtrip present. |
| Implement llama.cpp HTTP client | Done | `crates/yips-llm/src/client.rs`, `crates/yips-llm/src/stream.rs` | Streaming SSE and non-streaming support present. |
| Unit tests for config, IPC, message types | Done | `crates/yips-core/src/config.rs`, `crates/yips-core/src/ipc.rs` | Unit tests included in `#[cfg(test)]` modules. |

## Phase 1: Agent Engine

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Implement Tool trait and built-in tools | Done | `crates/yips-tools/src/tools.rs`, `crates/yips-tools/src/lib.rs` | Built-ins include read/write/edit/grep/run/list. |
| Implement ToolRegistry | Done | `crates/yips-tools/src/registry.rs` | Tool lookup and definition export present. |
| Skill manifest parsing and discovery | Done | `crates/yips-skills/src/manifest.rs`, `crates/yips-skills/src/discovery.rs` | Manifest parser and directory discovery implemented. |
| Skill subprocess runner with JSON protocol | Done | `crates/yips-skills/src/runner.rs` | JSON stdin/stdout protocol with typed response. |
| Envelope parser for LLM responses | Done | `crates/yips-agent/src/envelope.rs` | Envelope parsing module exists and is wired. |
| TurnEngine ReAct loop | Done | `crates/yips-agent/src/engine.rs` | Multi-round loop, tool execution, and events implemented. |
| Conductor for prompt composition + dispatch | Done | `crates/yips-agent/src/conductor.rs` | Conductor composes and dispatches turns. |
| AgentDependencies trait for testability | Done | `crates/yips-agent/src/engine.rs` | Trait abstraction used by engine and daemon deps. |

## Phase 2: Daemon + CLI (MVP)

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| IPC server accepting Unix socket connections | Done | `crates/yips-daemon/src/server.rs` | `UnixListener` accept loop and connection handler present. |
| Session management (create/list/resume) | Done | `crates/yips-daemon/src/session.rs`, `crates/yips-daemon/src/server.rs` | Session manager + list/info surfaces present. |
| llama.cpp lifecycle management | Done | `crates/yips-daemon/src/main.rs`, `crates/yips-daemon/src/server.rs` | Health-check path and startup flow present. |
| CLI `ask`, `sessions`, `status` subcommands | Done | `crates/yips-cli/src/main.rs` | Clap commands wired to IPC messages. |
| Wire daemon to agent engine end-to-end | Done | `crates/yips-daemon/src/server.rs`, `crates/yips-daemon/tests/ipc_e2e.rs` | End-to-end IPC tests exist; sandbox may block bind. |

## Phase 3A: TUI

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Message list with scrollback | Done | `crates/yips-tui/src/state.rs`, `crates/yips-tui/src/ui.rs` | Message/event history with scroll state implemented. |
| Streaming token display from daemon via IPC | Done | `crates/yips-tui/src/state.rs` | Handles `DaemonMessage::Token` and streaming buffer. |
| Tool call rendering as bordered blocks with status | Done | `crates/yips-tui/src/ui.rs`, `crates/yips-tui/src/state.rs` | Tool start/result events mapped to rendered entries. |
| Input editor with history | Done | `crates/yips-tui/src/state.rs`, `crates/yips-tui/src/main.rs` | Input buffer and history controls implemented. |
| Title bar and status bar metrics | Done | `crates/yips-tui/src/ui.rs` | Session, round, and state indicators displayed. |

## Phase 3B: Gateway

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Define BotAdapter trait | Done | `crates/yips-gateway/src/bot_adapter.rs` | Adapter abstraction implemented and exercised by tests. |
| Implement Discord adapter | Done | `crates/yips-gateway/src/discord_adapter.rs` | Serenity-backed adapter receives messages and sends replies with trigger mode, DM policy, and outbound chunking. |
| Implement Telegram adapter | Done | `crates/yips-gateway/src/telegram_adapter.rs`, `crates/yips-gateway/src/main.rs`, `crates/yips-core/src/config.rs` | Teloxide-backed adapter wired into shared runtime flow with strict chat allowlist and outbound chunking. |
| Auth policy and rate limiting | Done | `crates/yips-gateway/src/policy.rs`, `crates/yips-gateway/src/runtime.rs` | Enforced in runtime flow with unit tests. |
| Per-user session management | Done | `crates/yips-gateway/src/session_router.rs`, `crates/yips-gateway/src/runtime.rs` | Stable adapter/user session IDs routed to daemon. |
| Connect to daemon over IPC | Done | `crates/yips-gateway/src/daemon_client.rs` | IPC client wrapper connected to runtime and core tests. |
| Discord trigger extraction tests | Done | `crates/yips-gateway/src/discord_adapter.rs` | Mention/reply extraction covered with minimal Serenity message fixtures. |
| Discord outbound chunking tests | Done | `crates/yips-gateway/src/discord_adapter.rs` | Deterministic tests cover chunk sizing and newline boundary behavior. |
| Telegram inbound/outbound policy tests | Done | `crates/yips-gateway/src/telegram_adapter.rs`, `crates/yips-gateway/src/config.rs`, `crates/yips-core/src/config.rs` | Deterministic tests cover allowlist semantics, target resolution, and outbound chunking limits. |
| Graceful shutdown orchestration (SIGINT/SIGTERM) | Done | `crates/yips-gateway/src/orchestration.rs` | Internal shutdown signal abstraction and adapter task cancellation/drain behavior covered by orchestration tests. |
| Process-level SIGINT/SIGTERM integration test (Unix, ignored) | Done | `crates/yips-gateway/tests/gateway_signal_process.rs`, `crates/yips-gateway/src/bin/gateway_signal_harness.rs`, `.github/workflows/gateway-hardening.yml` | Run with `cargo test -p yips-gateway --test gateway_signal_process -- --ignored`; optional CI hardening lane is manually triggered via `workflow_dispatch` on Linux (`cargo test --locked -p yips-gateway --test gateway_signal_process -- --ignored`). Test remains Unix-only, `#[ignore]`, and environment-sensitive by design. |
| Local real-token smoke-test runbook | Done | `docs/roadmap/phase-3b-gateway.md` | Includes config template, startup commands, expected logs, and SIGINT/SIGTERM verification steps. |

## Phase 4: Skills

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Skill directory scanning and manifest parsing | Done | `crates/yips-skills/src/discovery.rs`, `crates/yips-skills/src/manifest.rs` | Implemented and exported. |
| Subprocess runner with JSON stdin/stdout | Done | `crates/yips-skills/src/runner.rs` | Request/response protocol implemented. |
| Timeout enforcement | Done | `crates/yips-skills/src/runner.rs` | Timeout handling and error mapping present. |
| Built-in example skills (weather, web search) | Remaining | `crates/yips-skills/src/` | No built-in weather/web-search examples present. |
| Skill hot-reload on filesystem changes | Remaining | `crates/yips-skills/src/` | No filesystem watcher/hot-reload path present. |

## Phase 5: Subagents + Polish

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Subagent orchestration | Remaining | `docs/roadmap/phase-5-subagents.md` | No implementation evidence in `yips-agent` yet. |
| Conversation memory and persistence | Remaining | `docs/roadmap/phase-5-subagents.md` | Not implemented. |
| Hook system for extensibility | Remaining | `docs/roadmap/phase-5-subagents.md` | Not implemented. |
| Model manager | Remaining | `docs/roadmap/phase-5-subagents.md` | Not implemented. |

## Phase 6: Packaging

| Task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Static binary builds (musl) | Remaining | `docs/roadmap/phase-6-packaging.md` | Not started. |
| systemd units for daemon and gateway | Remaining | `docs/roadmap/phase-6-packaging.md` | Not started. |
| Install script | Remaining | `docs/roadmap/phase-6-packaging.md` | Not started. |
| Migration tool from yips-tui config/data | Remaining | `docs/roadmap/phase-6-packaging.md` | Not started. |

## Next Implementation Target

Progress Phase 4 by implementing built-in example skills (weather/web search) and adding evidence for skill execution flows.
