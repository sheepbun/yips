## 2026-02-25 19:19 MST — Exchange 190

Summary: Fixed silent no-output behavior for blank assistant replies by adding a fallback assistant message.

Changed:

- Updated `src/agent/core/turn-engine.ts`:
  - added empty assistant fallback constant: `(no response)`.
  - when parsed assistant text is empty and there are no actions, engine now emits fallback via `onAssistantText` and appends it to history.
  - this prevents turns from finishing silently with no visible output.
- Updated `tests/agent/core/turn-engine.test.ts`:
  - added regression test verifying blank assistant text now surfaces `(no response)` and is persisted in history.

Validation:

- `npm test -- tests/agent/core/turn-engine.test.ts tests/ui/tui/tui-action-box-render.test.ts tests/ui/messages.test.ts` — clean.

Next:

- Optional: run a quick manual live TUI check with the same prompt path to confirm UX in real backend streaming conditions.
