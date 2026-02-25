## 2026-02-25 16:07 MST — Exchange 186

Summary: Fixed Discord UX signal regressions by removing 👀 reaction after processing and switching typing indicator to Discord REST heartbeat so typing reliably appears.

Changed:

- Updated `src/gateway/runtime/discord-bot.ts`:
  - Typing signal now uses Discord REST endpoint `POST /channels/{channelId}/typing` with bot auth, driven from parsed inbound `channelId`.
  - Added typing heartbeat loop (8s) over REST and cleanup on every message path.
  - Added reaction cleanup via Discord REST endpoint:
    - `DELETE /channels/{channelId}/messages/{messageId}/reactions/%F0%9F%91%80/@me`
    - executed in `finally`, best-effort/non-fatal.
  - Retained non-fatal behavior for all reaction/typing signal failures via `onError`.
  - Updated message event listener to await `handleDiscordMessage(...)` for deterministic completion in tests.

Tests:

- Updated `tests/gateway/runtime/discord-bot.test.ts`:
  - assertions now verify:
    - typing REST calls are issued while dispatch is pending,
    - reaction delete REST call occurs after processing,
    - outbound message send counts remain correct despite additional signal calls.
  - typing failure scenario now simulates REST typing endpoint failure and confirms dispatch/outbound still proceed.
  - all existing coverage for chunking, no-response, and non-ok responses remains intact.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/runtime/discord-bot.test.ts` — clean (8 tests)

Next:

- Optional: add a runtime debug toggle to log gateway signal endpoint statuses (`typing/reaction delete`) for easier diagnosis of Discord permission issues in live deployments.
