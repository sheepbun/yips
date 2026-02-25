## 2026-02-25 11:39 MST — Exchange 117

Summary: Restored expected blank-line spacing after assistant replies while keeping streaming deduplication fix.
Changed:

- Updated `src/tui.ts` chat loop post-reply rendering:
  - always appends one trailing blank output line after assistant content is accepted.
  - preserves prior guard that avoids double-rendering streamed assistant message bodies.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-resize-render.test.ts tests/tui-busy-indicator.test.ts` — clean
  Next:
- Optional: add an explicit regression test for streamed reply rendering + trailing spacer behavior in the chat loop.
