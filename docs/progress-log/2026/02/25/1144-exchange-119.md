## 2026-02-25 11:44 MST — Exchange 119

Summary: Removed persistent model-preload status text from chat/output history to prevent layout/title displacement side effects.
Changed:

- Updated `src/tui.ts`:
  - removed `/model` path chat-output lines for:
    - `Loading <model> into <GPU/CPU>...`
    - `Model preload complete.`
  - removed Model Manager submit path chat-output lines for the same preload status text.
  - removed startup `process.stdout.write(...)` preload banner before Ink mount.
  - preserved actual preload behavior and failure reporting (errors still surface).
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-resize-render.test.ts tests/tui-busy-indicator.test.ts` — clean
  Next:
- Optional: if desired, preload progress can be shown only in transient spinner/footer state (never persisted to output history).
