## 2026-02-25 05:33 MST — Exchange 155

Summary: Implemented the Milestone 4 WhatsApp platform adapter (Meta Cloud API shape) with inbound normalization and outbound Graph API formatting.
Changed:

- Added `src/gateway/adapters/whatsapp.ts`:
  - `WhatsAppAdapter` implementing `GatewayAdapter` for platform `whatsapp`
  - parses Cloud API webhook envelopes (`entry[] -> changes[] -> value.messages[]`) into normalized `GatewayIncomingMessage` objects
  - ignores non-text payloads/status-only updates and malformed message entries safely
  - maps sender/message/timestamp/channel fields and preserves useful metadata (`waId`, `profileName`, phone number metadata)
  - formats outbound gateway responses into Graph API `POST /{version}/{phone_number_id}/messages` requests with bearer auth
- Added `tests/gateway/adapters/whatsapp.test.ts` covering:
  - webhook text message normalization
  - multi-entry parsing with invalid/non-text filtering
  - status-only envelope suppression
  - outbound request payload/endpoint/header formatting
  - empty-response suppression (`null` outbound)
- Updated docs:
  - `docs/roadmap.md`: marked `WhatsApp adapter (WhatsApp Business API)` complete.
  - `docs/guides/gateway.md`: updated platform status table and adapter module list with WhatsApp adapter.
  - `docs/project-tree.md`: added `src/gateway/adapters/whatsapp.ts`.
  - `docs/changelog.md`: added unreleased WhatsApp adapter milestone entry.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/adapters/whatsapp.test.ts` — clean
- `npm test` — clean (43 files, 361 tests)
- `npm run build` — clean

Next:

- Implement the next unchecked Milestone 4 adapter: Discord adapter (Bot SDK) on the same `GatewayAdapter` contract.
