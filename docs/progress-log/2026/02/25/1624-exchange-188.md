## 2026-02-25 16:24 MST — Exchange 188

Summary: Added Telegram 👀 reaction cleanup so the bot clears the reaction only after successful outbound send(s).

Changed:

- Updated `src/gateway/runtime/telegram-bot.ts`:
  - added `tryClearEyesReaction(inbound)`:
    - calls Telegram `setMessageReaction` with `reaction: []` to clear reaction.
    - guarded by valid `channelId` + positive integer `messageId`.
    - best-effort error handling via `onError` (non-fatal).
  - updated inbound message handling flow:
    - tracks `didSendOutboundMessage` flag.
    - sets flag after each successful outbound `sendMessage` request.
    - in `finally`, stops typing heartbeat and clears 👀 only when `didSendOutboundMessage === true`.
  - preserved existing behavior:
    - initial 👀 set attempt still happens before dispatch.
    - typing lifecycle unchanged.
    - set/clear reaction failures do not block dispatch/send path.

Tests:

- Expanded `tests/gateway/runtime/telegram-bot.test.ts`:
  - added helpers to distinguish reaction set vs reaction clear calls by request body.
  - verified success path performs both set and clear reaction calls.
  - verified no-response path sets reaction but does not clear.
  - added failure case: outbound send failure does not trigger clear.
  - added failure case: reaction clear failure is non-fatal and reported.
  - retained existing typing heartbeat and retry/backoff coverage.

Documentation:

- Updated `docs/guides/gateway.md` Telegram runtime behavior to note 👀 reaction is cleared after successful outbound send.
- Updated `docs/changelog.md` with unreleased note for Telegram reaction clear behavior.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/runtime/telegram-bot.test.ts` — clean (8 tests)

Next:

- Optional: align Telegram reaction-clear timing with Discord by adding a configurable signal policy (for example clear-on-send, clear-always, or keep-reaction).
