## 2026-02-24 20:00 MST — Exchange 131

Summary: Fixed overscrolling by introducing a hard chat scroll cap that stops at the first viewport offset where the full title box is visible and chat content starts directly beneath it.
Changed:

- Updated `src/tui.ts`:
  - added `computeTitleVisibleScrollCap(rows, titleLines, outputLines, promptLines)`:
    - computes base scroll limit from first non-empty output line,
    - finds the first offset where full title visibility is restored and output starts immediately below title.
  - added `shiftOutputScrollOffsetWithCap(...)` and switched chat scroll handlers (`PgUp/PgDn` and wheel line scroll) to use the computed cap.
  - scroll offset is now clamped against that cap in the input path, preventing further upward drift once title+chat boundary is reached.
- Updated `tests/tui-resize-render.test.ts`:
  - added `computeTitleVisibleScrollCap` regression test asserting cap lands on full-title + first-chat-below layout.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (31 files, 294 tests)
  Next:
- Optional: add a UI-level integration harness around the stdin action loop to assert repeated scroll events saturate at the computed cap during interactive input.
