## 2026-02-25 12:43 MST — Exchange 174

Summary: Updated TUI tool-progress UX so action envelopes no longer preview tool calls during assistant streaming, and action execution now uses per-call busy lifecycle with tool-specific labels.

Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - `renderAssistantStreamForDisplay(...)` no longer emits streamed action call previews from parsed envelopes.
  - kept assistant prose + protocol warnings/errors rendering, and continued suppressing raw fenced envelope text during partial/active streaming.
  - added `runWithBusyLabel(...)` helper to scope busy start/stop with `try/finally`.
  - `executeToolCalls(...)` now runs each tool under `Running <tool>...` busy label.
  - `executeSkillCalls(...)` now runs each skill under `Running <skill>...` busy label.
  - `executeSubagentCalls(...)` now runs each subagent under `Running subagent <id>...` busy label.
  - retained one blank separator line after each action result block so outputs remain visually separated.
- Updated tests:
  - `tests/ui/tui/tui-action-box-render.test.ts` now asserts no streamed action previews in normal/verbose modes.
  - adjusted multi-action stream test to verify grouped preview lines are not rendered.
  - `tests/ui/tui/tui-busy-indicator.test.ts` now includes tool-specific busy-line coverage.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts tests/ui/messages.test.ts` — clean.
- `npm test` — 1 unrelated failure in `tests/llm/llama-server.test.ts` (`startLlamaServer` immediate-exit case), all UI/TUI tests relevant to this change passed.

Next:

- Re-run full suite to confirm whether `tests/llm/llama-server.test.ts` failure is transient/flaky in this environment.
