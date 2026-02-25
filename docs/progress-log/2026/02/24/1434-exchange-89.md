## 2026-02-24 14:34 MST — Exchange 89

Summary: Refined title token display formatting and made used-token count update on every turn (user input + assistant response).
Changed:

- Updated `src/token-counter.ts`:
  - `formatTitleTokenUsage(...)` now removes redundant trailing `.0` in both used and max segments.
    - examples: `0/32k tks` (instead of `0.0/32.0k tks`), `15.7/32.2k tks` unchanged.
  - added `estimateConversationTokens(...)` (rough estimate: `ceil(chars/4)` per message).
- Updated `src/tui.ts` token-update flow:
  - after each user message append, `usedTokensExact` is recalculated via `estimateConversationTokens(...)`.
  - after each assistant message:
    - if exact backend `total_tokens` is available, it is used.
    - otherwise fallback estimate is recalculated from conversation history.
  - when loading a saved session, token usage now initializes from estimated history usage.
- Updated tests in `tests/token-counter.test.ts`:
  - added no-trailing-`.0` formatting regression.
  - added conversation token estimation coverage.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/token-counter.test.ts tests/llama-client.test.ts tests/commands.test.ts tests/tui-resize-render.test.ts` — clean (64 passing)
- `npm test` — clean (23 files, 238 tests)
- `npm run lint` — clean
  Next:
- Run `npm run dev` and verify live behavior for:
  - initial display `0/<auto-or-manual>k tks`,
  - increment after user submit,
  - increment/replace after assistant response,
  - `/tokens auto` and `/tokens <value>` transitions.
