## 2026-02-25 06:54 MST — Exchange 157

Summary: Implemented Milestone 4 authentication/access-control hardening with sender allowlist + optional passphrase handshake, explicit unauthorized responses, and Discord runtime reply propagation for auth outcomes.
Changed:

- Added `src/gateway/auth-policy.ts`:
  - implements sender allowlist enforcement
  - implements optional `/auth <passphrase>` parsing/validation
  - persists authenticated sender state in-memory scoped by `platform + senderId`
- Updated `src/gateway/core.ts`:
  - added `GatewayCoreOptions.passphrase` and `GatewayCoreOptions.unauthorizedMessage`
  - moved auth checks to `GatewayAuthPolicy`
  - returns explicit unauthorized results with response text (`sender_not_allowed`, `passphrase_required`, `passphrase_invalid`)
  - returns `status: "authenticated"` plus success response for valid `/auth` handshake events
  - keeps normal `ok` dispatch path for authorized chat messages
- Updated `src/gateway/types.ts`:
  - added `"authenticated"` to `GatewayDispatchStatus`
- Updated Discord gateway runtime:
  - `src/gateway/runtime/discord-bot.ts` now emits outbound replies whenever `dispatch(...)` returns a response payload, including non-`ok` statuses
  - `src/gateway/runtime/discord-main.ts` now reads optional `YIPS_GATEWAY_PASSPHRASE` and passes it to `GatewayCore`
- Added/expanded tests:
  - new `tests/gateway/auth-policy.test.ts` (5 tests)
  - expanded `tests/gateway/core.test.ts` for passphrase-required/invalid/handshake/persistence/scoping behavior
  - expanded `tests/gateway/runtime/discord-bot.test.ts` for non-`ok` + response outbound send behavior
- Updated docs:
  - `docs/roadmap.md`: marked Milestone 4 `Authentication and access control` complete
  - `docs/guides/gateway.md`: documented passphrase env var and `/auth` flow
  - `docs/project-tree.md`: added `src/gateway/auth-policy.ts`
  - `docs/changelog.md`: added unreleased auth hardening entry

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (46 files, 379 tests)
- `npm run build` — clean

Next:

- Implement the next unchecked Milestone 4 item: platform-specific outbound formatting policy/normalization (Markdown/mentions/newlines/chunking parity across adapters).
