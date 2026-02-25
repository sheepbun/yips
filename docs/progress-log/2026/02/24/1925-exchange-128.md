## 2026-02-24 19:25 MST — Exchange 128

Summary: Implemented mouse-wheel chat scrollback in the Ink TUI so off-screen chat history can be browsed with normal wheel input.
Changed:

- Updated `src/input-engine.ts`:
  - added `scroll-line-up` / `scroll-line-down` input actions.
  - added SGR mouse CSI parsing (`\x1b[<64;...M` / `\x1b[<65;...M`) for wheel up/down.
  - retained existing page scroll parsing (`\x1b[5~`, `\x1b[6~`) as keyboard fallback.
- Updated `src/tui.ts`:
  - enabled terminal mouse reporting on app mount (`?1000h`, `?1006h`) and disabled it on cleanup (`?1000l`, `?1006l`).
  - wired wheel actions in chat mode to output scrollback offset changes (line-step increments).
  - preserved existing `PgUp` / `PgDn` paging behavior and footer `scroll +N` status.
- Updated `tests/input-engine.test.ts`:
  - added SGR mouse wheel parser coverage.
  - added engine coverage for wheel actions and split-chunk mouse CSI parsing.
- Updated docs:
  - `docs/guides/getting-started.md` now documents mouse-wheel chat scrollback and `PgUp`/`PgDn` fallback.
  - `docs/changelog.md` updated with the new scrollback behavior and refreshed last-updated date.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/input-engine.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (31 files, 292 tests)
  Next:
- Optional: add a focused TUI input integration harness that asserts mouse-wheel actions mutate `outputScrollOffset` through the `stdin` event path (not just parser-level coverage).
