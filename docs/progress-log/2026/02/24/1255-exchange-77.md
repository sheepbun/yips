## 2026-02-24 12:55 MST — Exchange 77

Summary: Fixed segmented-border gradient restarts so downloader top border and prompt bottom border now render as continuous left-to-right gradients.
Changed:

- Updated `src/colors.ts`:
  - added `horizontalGradientAtOffset(...)` helper to render gradients using absolute column offsets for segmented strings.
- Updated `src/downloader-ui.ts`:
  - rewired `makeBorderTop(...)` to color prefix/title/tail/fill/right-corner with absolute-offset gradient coloring.
  - preserved bold title styling while removing gradient restart around title segment.
- Updated `src/tui.ts`:
  - rewired prompt bottom border rendering in `buildPromptRenderLines(...)`:
    - left corner, fill, and right corner now use absolute-offset gradient coloring.
    - status text remains blue, but border gradient no longer restarts at fill.
- Updated tests:
  - `tests/downloader-ui.test.ts` added top-border continuity assertion ensuring title segment does not reset to start-pink.
  - `tests/tui-resize-render.test.ts` added bottom-border continuity assertion ensuring fill column does not reset to start-pink.
    Validation:
- `npm test -- tests/downloader-ui.test.ts tests/tui-resize-render.test.ts` — clean (23 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional visual check via `npm run dev` in your terminal to confirm continuity looks correct under your font/ANSI renderer.
