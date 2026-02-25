## 2026-02-25 13:48 MST — Exchange 136

Summary: Restored the blank separator row between the title box and first chat message at top scrollback while preserving overscroll limits.
Changed:

- Updated `src/tui.ts`:
  - top-scroll viewport now explicitly reserves `TITLE_OUTPUT_GAP_ROWS` between visible title lines and output content.
  - top-scroll content capacity and useful-cap math now account for that reserved gap (`computeUsefulOutputScrollCapRows`).
  - top-scroll render branches now prepend the reserved gap before visible output rows.
- Updated `tests/tui-resize-render.test.ts`:
  - top-scroll assertions now verify the separator blank row appears before the first content line.
  - adjusted one cap regression viewport height to a geometry where `title + gap + first output + prompt` can coexist.

Validation:

- `npm test -- tests/tui-resize-render.test.ts tests/input-engine.test.ts` — clean (42 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean

Next:

- Run a quick live TUI check in the user’s terminal profile to confirm this separator appears exactly where expected during wheel/page scroll.
