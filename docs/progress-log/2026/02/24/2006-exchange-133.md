## 2026-02-24 20:06 MST — Exchange 133

Summary: Fixed severe scroll regression by restoring synchronized live scroll behavior for intermediate offsets and reserving special full-title layout only at the true top-of-scroll offset.
Changed:

- Updated `src/tui.ts`:
  - restored normal title/output coupled displacement for non-max scroll offsets.
  - reintroduced `isAtTopOfScrollback` mode only when `outputScrollOffset` reaches computed maximum.
  - in top mode only:
    - disables title gap pressure,
    - prevents title displacement,
    - appends underfill padding below output so title remains fully visible with first content directly below.
  - simplified `computeTitleVisibleScrollCap(...)` to return the structural max offset (derived from first non-empty output line), relying on top-mode layout at that offset for deterministic stop behavior.
- Updated `tests/tui-resize-render.test.ts`:
  - restored intermediate scroll expectation (title can still be displaced while scrolling).
  - retained top-cap regression coverage.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (31 files, 294 tests)
  Next:
- Optional: add an explicit integration test for repeated wheel/page scroll events to verify smooth progression from live view to top-stop boundary in one scenario.
