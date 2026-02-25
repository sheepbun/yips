## 2026-02-23 14:32 MST — Exchange 25

Summary: Refactored TUI viewport rendering so the title box is fixed at the top and the prompt box remains anchored at the bottom.
Changed:

- Updated `src/tui.ts`:
  - removed title-box insertion into `outputLines` (deleted session-header append path)
  - simplified `resetSession(...)` to clear conversation/output state only
  - added exported `computeVisibleLayoutSlices(...)` helper to allocate fixed top title, middle output, and fixed bottom prompt rows based on terminal height
  - integrated live per-render title computation (`renderTitleBox(...)`) so model/backend/session metadata updates are reflected immediately
  - changed final Ink node composition order to always render `title -> output -> prompt`
  - fixed zero-capacity middle slice edge case (`slice(-0)`) by returning empty output rows when no middle viewport space exists
- Updated `tests/tui-resize-render.test.ts`:
  - added `computeVisibleLayoutSlices` coverage for: - normal height allocation - short-height behavior preserving prompt rows first - prompt-taller-than-terminal clipping behavior
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (119 passing)
  Next:
- Perform an interactive visual pass with `npm run dev` to confirm top/bottom anchoring behavior across manual terminal resizes and multiline prompt growth.
