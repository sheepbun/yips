## 2026-02-25 13:09 MST — Exchange 179

Summary: Improved TUI action-chain responsiveness so tool/skill/subagent boxes render immediately and the thinking loader resumes between action steps.
Changed:

- Updated `src/ui/tui/runtime-core.ts` action execution callbacks:
  - `executeToolCalls`, `executeSkillCalls`, and `executeSubagentCalls` now call `forceRender()` immediately after appending action call boxes.
  - These callbacks now also call `forceRender()` immediately after appending action result boxes.
  - After each displayed action result (including deny/error branches), the busy spinner is restarted with `Thinking...` via `startBusyIndicator("Thinking...")` so users see continued progress while the next assistant round is prepared.
- Updated React callback dependency arrays to include `forceRender` / `startBusyIndicator` where used.

Validation:

- `npm run typecheck` — clean
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean
- `npm run lint` — fails due pre-existing unused parameter lint in `src/ui/tui/runtime-core.ts` at `renderAssistantStreamForDisplay` (`_verbose`)

Next:

- Add a focused TUI integration test around multi-round tool chaining to lock in immediate action box rendering and thinking-spinner resume behavior.
