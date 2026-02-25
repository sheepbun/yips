## 2026-02-25 05:44 MST — Exchange 156

Summary: Implemented Milestone 4 Discord support with adapter parsing/formatting, discord.js runtime dispatch wiring into `GatewayCore`, and Discord-safe outbound message chunking.
Changed:

- Added `src/gateway/adapters/discord.ts`:
  - `DiscordAdapter` implementing `GatewayAdapter` for platform `discord`.
  - Parses Discord message-create style payloads into `GatewayIncomingMessage` for DM + guild text baselines.
  - Ignores bot/system/webhook/non-text payloads.
  - Formats outbound requests for Discord API `POST /channels/{channelId}/messages`.
  - Added `chunkDiscordMessage(...)` utility for safe auto-chunking at Discord message limits.
- Added runtime modules:
  - `src/gateway/runtime/discord-bot.ts`: discord.js-backed runtime loop that listens to `messageCreate`, dispatches through `GatewayCore`, and sends one-or-many outbound requests sequentially.
  - `src/gateway/runtime/discord-main.ts`: executable runtime entrypoint with env config (`YIPS_DISCORD_BOT_TOKEN`, optional `YIPS_GATEWAY_ALLOWED_SENDERS`).
- Updated gateway adapter contract:
  - `src/gateway/adapters/types.ts` `formatOutbound(...)` now supports returning a single request, an array of requests, or `null`.
- Added tests:
  - `tests/gateway/adapters/discord.test.ts`
  - `tests/gateway/runtime/discord-bot.test.ts`
- Updated package/runtime wiring:
  - `package.json`: added `gateway:discord` script and `discord.js` dependency.
  - `package-lock.json` updated via `npm install`.
- Updated docs:
  - `docs/roadmap.md`: marked Milestone 4 `Discord adapter (Bot SDK)` complete.
  - `docs/guides/gateway.md`: Discord status moved to implemented and runtime/env details added.
  - `docs/project-tree.md`: added new Discord adapter/runtime files and `tests/gateway/` test-tree entry.
  - `docs/changelog.md`: added unreleased Discord adapter/runtime notes and adapter contract change.

Validation:

- `npm install` — clean
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/adapters/discord.test.ts tests/gateway/runtime/discord-bot.test.ts` — clean
- `npm test` — clean (45 files, 369 tests)
- `npm run build` — clean

Next:

- Implement the next unchecked Milestone 4 item: authentication and access control hardening beyond sender allowlists (for example API key/passphrase policy + explicit unauthorized response strategy).
