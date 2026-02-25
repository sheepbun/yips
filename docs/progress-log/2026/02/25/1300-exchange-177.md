## 2026-02-25 13:00 MST — Exchange 177

Summary: Improved long-wait streaming UX by rendering an immediate assistant placeholder message while waiting for first stream tokens.

Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - in the streaming branch of `requestAssistantFromLlama(...)`, immediately seeds the output block with:
    - `formatAssistantMessage("Thinking...", timestamp)`
  - this placeholder is replaced in-place as real stream content becomes available, preserving existing block-replacement behavior.
  - keeps existing sequential action execution rendering and envelope suppression logic unchanged.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts tests/ui/messages.test.ts` — clean.

Next:

- If needed, tune placeholder text (for example `Working...`) or make it configurable by mode (`chat` vs `subagent` requests).
