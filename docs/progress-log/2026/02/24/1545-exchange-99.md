## 2026-02-24 15:45 MST — Exchange 99

Summary: Updated upper-layout slicing so output consumes the title/prompt gap first, and only then begins pushing title lines off-screen.
Changed:

- Updated `src/tui.ts`:
  - rewrote `computeVisibleLayoutSlices(...)` to use explicit phases:
    - preserve prompt rows at the bottom,
    - let output fill available gap under the title first,
    - then displace visible title rows,
    - then scroll older output once title is fully displaced.
  - retained output top-padding behavior only when visible output is shorter than the remaining upper area.
- Updated `tests/tui-resize-render.test.ts`:
  - added threshold regression test ensuring the full title remains visible when output exactly fills the gap, and bumping starts only after that point.
    Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (17 passing)
- `npm run typecheck` — clean
  Next:
- Optional interactive verification with `npm run dev` to confirm the gap-fill and title-bump behavior feels correct during live chat output.
