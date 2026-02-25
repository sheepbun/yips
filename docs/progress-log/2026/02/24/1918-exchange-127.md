## 2026-02-24 19:18 MST — Exchange 127

Summary: Added persistent one-row buffer between title and chat content before title displacement, and normalized chat message spacing to include a blank line after each user and assistant output.
Changed:

- Updated `src/tui.ts`:
  - added `TITLE_OUTPUT_GAP_ROWS = 1`.
  - updated `computeVisibleLayoutSlices(...)` to reserve one row beneath visible title lines before output can begin displacing the title.
  - updated `handleUserMessage(...)` to append a blank spacer line immediately after formatted user output.
  - updated `replayOutputFromHistory(...)` to include the same post-user blank spacer so restored sessions match live rendering.
- Updated `tests/tui-resize-render.test.ts`:
  - adjusted layout expectations for the new reserved title gap behavior.
  - retained wrapped-row and spacer regressions under new policy.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (22 passing)
- `npm run typecheck` — clean
  Next:
- Optional: run `npm test` full suite before release tagging.
