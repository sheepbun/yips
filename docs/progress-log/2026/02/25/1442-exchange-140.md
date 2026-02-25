## 2026-02-25 14:42 MST — Exchange 140

Summary: Implemented Milestone 2 subagent delegation with scoped context and lifecycle result chaining.
Changed:

- Extended protocol/types for subagent delegation:
  - `src/types.ts`: added `SubagentCall` / `SubagentResult` contracts.
  - `src/tool-protocol.ts`: parser now accepts `subagent_calls` in ` ```yips-tools ` blocks with normalized `task`, optional `context`, optional `allowed_tools`, and optional `max_rounds`.
- Updated Conductor orchestration (`src/conductor.ts`):
  - added optional `executeSubagentCalls(...)` dependency.
  - runs delegation rounds when `subagent_calls` are present and injects `Subagent results: ...` into system history.
  - warns and emits fallback error results when delegation is requested but no subagent runner is configured.
- Wired runtime subagent execution in `src/tui.ts`:
  - `requestAssistantFromLlama(...)` now supports scoped request options (`historyOverride`, `codeContextOverride`, `busyLabel`, `streamingOverride`).
  - added delegated subagent executor that spawns scoped histories, enforces per-call allowed tool lists, runs bounded conductor loops, and returns lifecycle metadata (rounds/duration/warnings).
  - main chat turn now passes `executeSubagentCalls` into `runConductorTurn(...)`.
- Added/updated tests:
  - `tests/tool-protocol.test.ts`: covers valid `subagent_calls` parsing.
  - `tests/conductor.test.ts`: covers delegated subagent result chaining and missing-runner fallback warnings.
- Docs updates:
  - `docs/roadmap.md`: marked Milestone 2 `Subagent system` complete.
  - `docs/changelog.md`: added subagent system implementation notes under Unreleased.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/conductor.test.ts tests/tool-protocol.test.ts` — clean
- `npm test` — clean (34 files, 313 tests)

Next:

- Reconcile Milestone 3 `Hardware detection` roadmap status with implemented `src/hardware.ts` behavior (either complete the remaining auto-selection wiring or document the remaining gap explicitly).
- Add a focused integration harness for live `stdin.on("data")` mode transitions and scroll event saturation (the existing optional follow-up from Exchanges 97/98).
