## 2026-02-25 11:37 MST — Exchange 116

Summary: Fixed duplicate assistant output bug in streaming mode.
Changed:

- Updated `src/tui.ts` chat loop:
  - after `requestAssistantFromLlama()`, assistant text is no longer appended again when `reply.rendered === true`.
  - streamed responses now render once (live token updates) while still recording assistant content to history.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts tests/commands.test.ts` — clean
- `npm test` — clean (31 files, 285 tests)
  Next:
- Optional: add a focused unit/integration seam for streamed chat-loop rendering to lock regression behavior explicitly.
