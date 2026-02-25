## 2026-02-25 16:18 MST — Exchange 187

Summary: Implemented Telegram runtime long-poll gateway with typing/reaction UX signals and background auto-start integration alongside Discord.

Changed:

- Added Telegram runtime loop:
  - new `src/gateway/runtime/telegram-bot.ts`.
  - long-polling via Telegram Bot API `getUpdates` with in-memory offset tracking.
  - per-message dispatch through `GatewayCore`.
  - outbound send execution via existing `TelegramAdapter` request formatting.
  - typing UX signal: `sendChatAction` (`typing`) with heartbeat during processing.
  - best-effort 👀 reaction attempt via `setMessageReaction` when `messageId` is available.
  - non-fatal signal errors routed to runtime `onError`.
  - startup/shutdown lifecycle with abortable polling and stop-safe loop handling.
- Added standalone Telegram runtime entrypoint:
  - new `src/gateway/runtime/telegram-main.ts`.
  - token resolution from env or config:
    - `YIPS_TELEGRAM_BOT_TOKEN`
    - fallback `config.channels.telegram.botToken`
  - shared headless Conductor/GatewayCore setup parity with Discord main runtime.
- Background runtime integration:
  - updated `src/gateway/background.ts` to support both Discord and Telegram runtimes concurrently.
  - env/config token resolution for Telegram added.
  - background stop now tears down all active runtimes and disposes shared headless handler once.
  - startup rollback logic now stops already-started runtimes if a later runtime fails to start.
- Tooling/docs:
  - `package.json` script added: `gateway:telegram`.
  - updated `docs/guides/gateway.md` for Telegram runtime + env/background behavior.
  - updated `docs/changelog.md` with unreleased Telegram runtime/background notes.

Tests:

- Added `tests/gateway/runtime/telegram-bot.test.ts`:
  - polling->dispatch->send flow
  - typing heartbeat behavior and stop-after-completion
  - no-response outbound suppression
  - reaction/typing failure tolerance
  - getUpdates failure retry/backoff path
  - chunked outbound sequential sends
- Updated `tests/gateway/background.test.ts`:
  - inactive when no Discord/Telegram token
  - Telegram-only startup
  - Discord+Telegram concurrent startup and shutdown
  - existing Discord behavior preserved

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/runtime/telegram-bot.test.ts tests/gateway/background.test.ts` — clean

Next:

- Optional: add a `telegram`/`discord` runtime health line in TUI status or `/setup` panel to show which background channels are currently active.
