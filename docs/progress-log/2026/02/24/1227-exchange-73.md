## 2026-02-24 12:27 MST — Exchange 73

Summary: Updated title-box typography and cwd display: bolded top `Yips version`, bolded `Recent activity`, and shortened cwd to `~/current-folder`.
Changed:

- Updated `src/title-box.ts`:
  - `makeTopBorder(...)` now bolds the `Yips <version>` title string in the top border while preserving existing gradient/blue color styling.
  - full-layout `Recent activity` heading is now bold (and remains white).
- Updated `src/tui.ts`:
  - added exported helper `formatTitleCwd(cwd)` that renders title cwd as `~/<basename>` and falls back to `~` for root/empty basename.
  - `buildTitleBoxOptions(...)` now passes `formatTitleCwd(process.cwd())` to title-box rendering.
- Updated tests:
  - `tests/title-box.test.ts` now asserts bold styling for top `Yips 0.1.0` and for `Recent activity`.
  - `tests/tui-resize-render.test.ts` now covers `formatTitleCwd(...)` output (`~/yips` and root `~`).
    Validation:
- `npm test -- tests/title-box.test.ts tests/tui-resize-render.test.ts` — clean (35 passing)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` for a quick visual confirmation in your terminal theme that the top-border bold weight and cwd shorthand read as intended.
