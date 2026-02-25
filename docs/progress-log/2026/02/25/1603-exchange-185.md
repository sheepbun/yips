## 2026-02-25 16:03 MST — Exchange 185

Summary: Implemented Discord UX signaling so gateway bot reacts with 👀 and maintains typing status while processing inbound messages.

Changed:

- Updated `src/gateway/runtime/discord-bot.ts`:
  - added runtime-safe message/channel interfaces for optional `react(...)` and `channel.sendTyping()`.
  - added `EYES_REACTION = "👀"` and typing heartbeat interval `TYPING_HEARTBEAT_MS = 8000`.
  - added `tryReactEyes(payload)`:
    - attempts reaction for each parsed inbound message.
    - failures are non-fatal and routed to `onError`.
  - added `startTypingHeartbeat(payload)`:
    - sends typing immediately and refreshes on interval while processing is active.
    - returns cleanup callback; cleanup is guaranteed via `finally`.
    - typing failures are non-fatal and routed to `onError`.
  - per-message flow now:
    - react 👀
    - start typing heartbeat
    - dispatch through gateway
    - send outbound responses if present
    - stop typing heartbeat in `finally`
  - updated `messageCreate` listener to await handler promise for deterministic completion in tests.

Tests:

- Expanded `tests/gateway/runtime/discord-bot.test.ts`:
  - added fake message helper with `react` and `channel.sendTyping` mocks.
  - added heartbeat test ensuring reaction + repeated typing during pending dispatch.
  - added cleanup test ensuring typing stops after outbound send completion.
  - added regression checks for no-response path (still reacts/types once).
  - added non-fatal failure coverage:
    - reaction failure does not block dispatch/outbound send.
    - typing failure does not block dispatch/outbound send.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/runtime/discord-bot.test.ts` — clean (8 tests)

Next:

- Optional: add an integration-level Discord runtime smoke test with delayed llama response simulation to verify real-time typing heartbeat cadence under longer-running gateway turns.
