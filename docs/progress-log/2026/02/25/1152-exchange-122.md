## 2026-02-25 11:52 MST — Exchange 122

Summary: Added model-switch output artifact cleanup to prevent legacy/pre-existing status lines from continuing to cause title-box bump pressure in the same session.
Changed:

- Updated `src/tui.ts`:
  - added `stripAnsi(...)` helper.
  - added `pruneModelSwitchStatusArtifacts(state)` to remove lines matching:
    - `Model set to: ...`
    - `Loading ... into GPU/CPU...`
    - `Model preload complete.`
      and trims trailing blank lines afterward.
  - wired cleanup before preload in both model-switch paths:
    - `/model <arg>` command path
    - Model Manager `submit` selection path
  - ensures old status lines from earlier runs/flows do not keep affecting layout after switching models.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/tui-resize-render.test.ts tests/tui-busy-indicator.test.ts` — clean
- `npm test` — clean (31 files, 286 tests)
  Next:
- Optional: expose a lightweight `/trim` or `/clean` command to prune historical non-chat status lines on demand.
