## 2026-02-25 12:25 MST — Exchange 173

Summary: Adjusted tool/action rendering so action envelopes never appear as partially streamed raw text and added visual spacing between each action output block.

Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - added `hasEnvelopeStart(...)` and changed `renderAssistantStreamForDisplay(...)` behavior:
    - when an envelope start fence is detected but the envelope is not yet parse-complete, raw fenced JSON is suppressed
    - only any plain-text prefix before the fence is rendered during streaming
  - added blank-line separation between multiple parsed action call previews in streamed assistant display
  - added a trailing empty line after each tool/skill/subagent result output block so each action output appears visually separated
  - removed previous verbose-only end-of-batch spacer lines (spacing is now per action block)
- Updated tests:
  - `tests/ui/tui/tui-action-box-render.test.ts` now covers:
    - no rendering of partial envelope text
    - blank-line separation between multiple streamed action call lines

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/messages.test.ts` — clean.
- `npm test` — clean (54 files, 421 tests).

Next:

- If desired, add a snapshot-style TUI render test to assert blank-line spacing for executed tool-call result blocks (not only streamed call previews).
