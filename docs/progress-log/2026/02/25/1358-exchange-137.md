## 2026-02-25 13:58 MST — Exchange 137

Summary: Adjusted chat transcript spacing so user prompts are immediately followed by assistant responses, with blank spacing only after assistant replies.
Changed:

- Updated `src/tui.ts`:
  - removed the blank-line append that occurred immediately after each user message in the live chat path (`handleUserMessage`).
  - extracted history-to-output rendering into `renderHistoryLines(...)` and updated replay flow to use it.
  - `renderHistoryLines(...)` now preserves the same spacing rule for loaded sessions/history replay: no blank line after user, one blank line after assistant.
- Added `tests/tui-history-render.test.ts`:
  - verifies user and assistant lines are adjacent.
  - verifies spacing appears only after assistant messages.

Validation:

- `npm test -- tests/tui-history-render.test.ts tests/tui-resize-render.test.ts tests/input-engine.test.ts` — clean (44 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean

Next:

- Optional live-terminal pass to confirm transcript spacing feels correct during streaming and non-streaming reply modes.
