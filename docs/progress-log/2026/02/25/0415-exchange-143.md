## 2026-02-25 04:15 MST — Exchange 143

Summary: Updated title-box directory display to use the actual launch cwd path instead of a `~/basename` shortcut.
Changed:

- Updated `src/tui.ts`:
  - `formatTitleCwd(...)` now returns the full trimmed cwd path (falling back to `/` only if empty), so the directory shown in the title box matches the real cwd at launch.
- Updated `tests/tui-resize-render.test.ts`:
  - adjusted `formatTitleCwd` expectations to assert full-path output for normal paths and `/` for root.

Validation:

- `npm test -- tests/tui-resize-render.test.ts` — clean (26 passing)

Next:

- Optional: run `npm test` for the full suite if you want an additional broad regression pass for this small UI behavior change.
