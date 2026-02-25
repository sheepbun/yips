## 2026-02-25 06:05 MST — Exchange 158

Summary: Implemented Milestone 4 platform-specific outbound formatting with shared adapter normalization/chunking policy and mention-safe plain-text output across Discord, Telegram, and WhatsApp.
Changed:

- Added shared formatting module `src/gateway/adapters/formatting.ts`:
  - `normalizeOutboundText(...)` for line-ending normalization, blank-line collapse, markdown stripping, and mention sanitization.
  - `stripCommonMarkdown(...)` to remove common markdown markers while preserving text content.
  - `sanitizeMentions(...)` to neutralize outbound mentions (`@everyone`, `@here`, user-like handles/IDs).
  - `chunkOutboundText(...)` for boundary-aware chunking with hard splits for oversized tokens.
- Updated `src/gateway/adapters/discord.ts`:
  - moved outbound normalization/chunking to shared formatting module.
  - retained `chunkDiscordMessage(...)` API as a wrapper over shared behavior.
- Updated `src/gateway/adapters/telegram.ts`:
  - added `TelegramAdapterOptions.maxMessageLength` (default `4000`).
  - outbound formatting now uses shared normalization + chunking.
  - `formatOutbound(...)` now returns single-request or multi-request payloads for long responses.
- Updated `src/gateway/adapters/whatsapp.ts`:
  - added `WhatsAppAdapterOptions.maxMessageLength` (default `4000`).
  - outbound formatting now uses shared normalization + chunking.
  - `formatOutbound(...)` now returns single-request or multi-request payloads for long responses.
- Added tests:
  - `tests/gateway/adapters/formatting.test.ts` for markdown stripping, mention sanitization, newline normalization, and chunk behavior.
- Expanded adapter tests:
  - `tests/gateway/adapters/discord.test.ts` verifies outbound markdown/mention sanitization.
  - `tests/gateway/adapters/telegram.test.ts` verifies sanitization + multi-request chunk output.
  - `tests/gateway/adapters/whatsapp.test.ts` verifies sanitization + multi-request chunk output.
- Updated docs:
  - `docs/roadmap.md`: marked Milestone 4 `Platform-specific message formatting` complete.
  - `docs/guides/gateway.md`: documented shared outbound formatting policy and per-platform limits.
  - `docs/project-tree.md`: added `src/gateway/adapters/formatting.ts`.
  - `docs/changelog.md`: added unreleased entry for platform-specific outbound formatting.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/adapters/formatting.test.ts tests/gateway/adapters/discord.test.ts tests/gateway/adapters/telegram.test.ts tests/gateway/adapters/whatsapp.test.ts` — clean
- `npm test` — clean (47 files, 385 tests)
- `npm run build` — clean
- `npm run format:check` — fails due to pre-existing repository-wide formatting drift (37 files), including unrelated files not touched in this exchange.

Next:

- Implement Milestone 4 `Headless Conductor mode (no TUI, API-driven)` by wiring `GatewayCore.handleMessage` to the existing Conductor runtime path and defining a minimal gateway session-to-conductor context bridge.
