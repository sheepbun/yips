## 2026-02-25 11:45 MST — Exchange 120

Summary: Removed persistent `Model set to: ...` chat output from TUI model-switch flows to avoid title-box displacement from status text accumulation.
Changed:

- Updated `src/tui.ts`:
  - `/model <arg>` command output is now suppressed in TUI render path (command still updates config/model and runs preload).
  - Model Manager submit path no longer appends `Model set to: ...` line before preload.
  - preserves error output when save/preload fails.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-resize-render.test.ts tests/tui-busy-indicator.test.ts` — clean
  Next:
- Optional: if desired, remove trailing blank line after successful model switch to keep output history even tighter.
