## 2026-02-24 14:55 MST — Exchange 94

Summary: Restored Thinking indicator to ~60fps render updates while keeping spinner glyph cadence stable.
Changed:

- Updated `src/tui.ts`:
  - changed busy animation repaint interval from `80ms` to `16ms` (~60fps) for smoother transient Thinking row animation.
- Updated `src/spinner.ts`:
  - made spinner frame progression time-based (`80ms` per frame) instead of advancing one frame on every render.
  - added internal frame timing state (`lastFrameTime`) and stepped frame advancement based on elapsed wall-clock time.
  - preserves existing pulsing color + elapsed-time display behavior.
- Updated `tests/spinner.test.ts`:
  - adjusted frame-cycling test to mock `Date.now()` and advance by `80ms`, matching time-based frame logic.
    Validation:
- `npm test -- tests/spinner.test.ts tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional visual check with `npm run dev` to confirm motion smoothness and spinner cadence in your terminal renderer.
