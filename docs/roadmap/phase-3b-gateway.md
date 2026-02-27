# Phase 3B: Gateway

Last verified: 2026-02-27

## Goal
Multi-channel bot daemon supporting Discord and Telegram.

## Dependencies
Phase 2

## Crates Touched
- `yips-gateway` (create)

## Tasks
- [x] Define BotAdapter trait
- [x] Implement Discord adapter (serenity)
- [x] Add Discord trigger policy config (`all_messages`, `mention_only`)
- [x] Add Discord DM policy config (`gateway.discord.allow_dms`, default `true`)
- [x] Add outbound Discord message chunking (`<= 2000` chars, newline-aware split)
- [x] Add deterministic Discord adapter tests for trigger extraction + chunking
- [x] Implement Telegram adapter (teloxide)
- [x] Auth policy and rate limiting
- [x] Per-user session management
- [x] Connect to daemon over IPC
- [x] Graceful shutdown orchestration on SIGINT/SIGTERM with adapter task cancellation
- [x] Unix-only process-level signal integration test (ignored by default)
- [x] Local real-token smoke-test runbook

## Deliverable
Discord path: send a message and receive AI response with policy enforcement.
Telegram path: send a message and receive AI response with policy enforcement.

## Status
Complete

## Current Discord Behavior
- Accepts non-bot, non-empty Discord messages.
- If `gateway.discord.allowed_guild_ids` is empty, all guilds are accepted.
- If `gateway.discord.allowed_guild_ids` is non-empty, only listed guilds are accepted.
- `gateway.discord.allow_dms` controls DM intake:
  - `true` (default): DMs are accepted (subject to non-bot/non-empty checks).
  - `false`: DMs are ignored.
- `gateway.discord.trigger_mode` controls guild trigger behavior:
  - `all_messages` (default): process all accepted guild messages.
  - `mention_only`: process guild messages only when the bot is mentioned
    or when the message replies to a bot-authored message.
- Outbound responses are split into sequential non-empty chunks of `<= 2000` chars,
  with newline-aware boundaries when available.

## Current Telegram Behavior
- Accepts non-bot, non-empty Telegram text messages.
- `gateway.telegram.allowed_chat_ids` is a strict allowlist:
  - If empty, all inbound Telegram messages are rejected.
  - If non-empty, only listed chat IDs are accepted.
- Outbound responses are split into sequential non-empty chunks of `<= 4096` chars,
  with newline-aware boundaries when available.
- Telegram and Discord adapters can run concurrently when both are enabled;
  if one adapter exits with error, the other continues running.

## Local Smoke-Test Runbook (Real Tokens, Local Only)

### Prerequisites
- A valid Discord bot token and/or Telegram bot token.
- A reachable LLM backend for `yips-daemon` (`[llm].base_url` in config).
- Unix-like shell for SIGTERM verification (`kill -TERM`).

### Config Template
Use a local config file such as `/tmp/yips-gateway-smoke.toml` and replace placeholders.

```toml
[llm]
base_url = "http://127.0.0.1:8080"
model = "your-model"
max_tokens = 512
temperature = 0.7

[daemon]
socket_path = "/tmp/yips-gateway-smoke.sock"
auto_start_llm = false

[agent]
max_rounds = 6
failure_pivot_threshold = 2

[skills]
extra_dirs = []
default_timeout_secs = 30

[gateway]
enabled = true
daemon_socket_path = "/tmp/yips-gateway-smoke.sock"

[gateway.auth]
allow_user_ids = [] # Optional: empty means all user IDs are allowed by runtime policy.

[gateway.rate_limit]
max_requests = 8
window_secs = 60

[gateway.session]
prefix = "gw"

[gateway.discord]
enabled = true
token = "DISCORD_BOT_TOKEN_HERE"
allowed_guild_ids = [] # Optional: empty allows all guilds.
allow_dms = true
trigger_mode = "mention_only" # or "all_messages"

[gateway.telegram]
enabled = true
token = "TELEGRAM_BOT_TOKEN_HERE"
allowed_chat_ids = ["123456789"] # Required allowlist for Telegram intake.
```

### Startup Commands
1. Start daemon:
   ```bash
   cargo run --bin yips-daemon -- --config /tmp/yips-gateway-smoke.toml
   ```
2. In a second terminal, start gateway:
   ```bash
   cargo run --bin yips-gateway -- --config /tmp/yips-gateway-smoke.toml
   ```

### Expected Logs
When startup is healthy, expect:
- Daemon: `Listening for IPC connections`
- Gateway: `Starting gateway adapter` for each enabled adapter (`discord`, `telegram`)

When stopping gateway, expect:
- `shutdown signal received; cancelling adapter tasks`
- task cancellation or clean adapter exits
- process exits without panic or backtrace

### Functional Verification
1. Send a Discord message that satisfies configured trigger policy, verify bot response.
2. Send a Telegram message from an allowed chat ID, verify bot response.
3. Confirm policy behavior:
   - Telegram messages from non-allowlisted chat IDs are ignored/rejected.
   - Discord trigger mode follows `all_messages` or `mention_only`.

### Shutdown Verification
1. In gateway terminal, press `Ctrl+C` (SIGINT) and confirm clean exit logs.
2. Restart gateway, record PID, then run:
   ```bash
   kill -TERM <gateway_pid>
   ```
3. Confirm the same clean shutdown behavior and cancellation logs.
4. Confirm daemon remains up unless you stop it separately.

### Failure Checks
- If an adapter is enabled and token is missing, startup fails fast with:
  - `gateway.discord.token is required when discord is enabled`
  - `gateway.telegram.token is required when telegram is enabled`
- Do not commit real tokens; keep secrets in local-only config files.

## Automated Signal Integration Test (Unix, Ignored by Default)
- Test file: `crates/yips-gateway/tests/gateway_signal_process.rs`
- Helper binary: `crates/yips-gateway/src/bin/gateway_signal_harness.rs`
- Command:
  ```bash
  cargo test -p yips-gateway --test gateway_signal_process -- --ignored
  ```
- Coverage:
  - Spawns a real process harness and sends `SIGINT` and `SIGTERM`.
  - Asserts clean process exit and expected shutdown/cancellation logs.
- Caveat:
  - Marked `#[cfg(unix)]` and `#[ignore]` because sandboxed CI environments may restrict process signal behavior.

### When to Run in CI (Manual Hardening)
- Workflow: `.github/workflows/gateway-hardening.yml` (`Gateway Hardening`, `workflow_dispatch`).
- Maintainers should trigger this workflow:
  - Before release cuts.
  - When a PR changes gateway shutdown, signal handling, process orchestration, adapter task cancellation/drain, or related runtime lifecycle code.
- Rationale:
  - Keep always-on CI fast while preserving explicit hardening coverage for environment-sensitive process-level signal behavior.
