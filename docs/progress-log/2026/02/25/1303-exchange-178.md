## 2026-02-25 13:03 MST — Exchange 178

Summary: Reverted the immediate streaming placeholder line (`Yips: Thinking...`) that was added in the prior exchange.

Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - removed the pre-seeded streaming output block that rendered `formatAssistantMessage("Thinking...", timestamp)` before first token arrival.
  - retained existing busy spinner behavior and all other streaming/action-rendering logic unchanged.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts tests/ui/messages.test.ts` — clean.

Next:

- If desired, implement a different first-response UX that does not print assistant placeholder text (for example status-only indicator in prompt/footer).
