## 2026-02-24 19:56 MST — Exchange 130

Summary: Fixed scrollback regression by applying title-lock behavior only at true max scroll, preserving normal intermediate scrolling while still enforcing the requested top-stop layout.
Changed:

- Updated `src/tui.ts` (`computeVisibleLayoutSlices`):
  - introduced `isAtTopOfScrollback` (`clampedOffset === maxOffset` and `maxOffset > 0`).
  - top-stop behavior now applies only when fully scrolled to the oldest visible content:
    - disables reserved title gap,
    - prevents title displacement,
    - bottom-pads underfilled rows so first visible message sits directly below title.
  - intermediate scroll offsets retain prior layout dynamics (including title displacement and top padding), avoiding collapsed output viewport behavior.
- Updated `tests/tui-resize-render.test.ts`:
  - retained/confirmed baseline intermediate scroll expectation.
  - kept top-scroll cap regression introduced in Exchange 92 to guard requested top-stop behavior.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (31 files, 293 tests)
  Next:
- Optional: add an interactive TUI input regression harness to validate wheel/page stepping behavior across offsets in addition to pure layout snapshots.
