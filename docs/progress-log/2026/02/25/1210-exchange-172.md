## 2026-02-25 12:10 MST — Exchange 172

Summary: Replaced bordered action boxes with compact bullet-style tool/skill/subagent rendering in the TUI, with verbose-only IDs and inline detail expansion.

Changed:

- Updated `src/ui/messages.ts`:
  - `formatActionCallBox(...)` now renders compact `● ...` call lines with tool-specific labels (`Bash`, `Read`, `List`, `Search`, `Write`, `Edit`).
  - `ActionCallBoxEvent` now accepts optional `arguments`.
  - `formatActionResultBox(...)` now renders compact `⎿ ...` summaries in normal mode and inline verbose detail lines (`id`, additional output lines, metadata).
  - Added `showIds` option (defaults to verbose behavior) and removed bordered box rendering helpers.
- Updated `src/ui/tui/runtime-core.ts`:
  - assistant stream envelope rendering now passes action arguments into `formatActionCallBox(...)`.
  - tool/skill/subagent execution paths now pass arguments for call-line labeling and `showIds` for verbose mode.
  - removed legacy verbose tag lines (`[tool]`, `[tool-result]`, `[skill]`, `[subagent]`) to keep output in the new compact style.
- Updated tests:
  - `tests/ui/messages.test.ts` now validates compact call/result rendering, verbose-only IDs, and no bordered-box fragments.
  - `tests/ui/tui/tui-action-box-render.test.ts` now validates compact envelope call rendering and verbose-only ID visibility.
- Updated docs:
  - `docs/changelog.md` now documents the compact bullet-style action rendering change.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/messages.test.ts tests/ui/tui/tui-action-box-render.test.ts` — clean.
- `npm test` — clean (54 files, 419 tests).

Next:

- Tune per-tool result summaries (for example, using metadata for cleaner `list_dir`/`grep` recap wording) if additional UX polish is desired.
