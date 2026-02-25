## 2026-02-25 13:40 MST — Exchange 134

Summary: Fixed chat scrolling reliability by making scrollback row-aware for wrapped output and broadening mouse wheel sequence parsing.
Changed:

- Updated `src/tui.ts` scroll math:
  - added display-row-aware helpers for scroll window trimming (`dropTrailingByDisplayRows`) and max scroll cap computation.
  - changed scroll cap policy to keep the first visible content row anchored (instead of pinning the entire first content line), enabling scrollback through wrapped first lines.
  - updated `computeVisibleLayoutSlices(...)` to clamp and apply offsets in display-row units.
  - updated `computeTitleVisibleScrollCap(...)` to use inferred render width and row-aware cap computation.
- Updated `src/input-engine.ts` mouse parsing:
  - SGR wheel detection now honors modifier bits (`shift`/`alt`/`ctrl`) via bitmask decoding, not only exact button codes `64/65`.
- Added regression coverage:
  - `tests/input-engine.test.ts`: wheel parsing tests for modifier-coded values (`80/81`) in both sequence and engine chunk paths.
  - `tests/tui-resize-render.test.ts`: wrapped-output scroll cap test ensuring non-zero cap where output wraps.

Validation:

- `npm test -- tests/input-engine.test.ts tests/tui-resize-render.test.ts` — clean (41 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean

Next:

- Manual terminal verification across a couple of emulators (kitty/alacritty/wezterm) to confirm wheel + PageUp/PageDown feel and direction match user expectation.
- If needed, refine partial wrapped-line trimming to preserve ANSI styles while scrolling through wrapped rows.
