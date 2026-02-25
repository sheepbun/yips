## 2026-02-25 11:05 MST — Exchange 168

Summary: Implemented a Milestone 2 hard reboot with a new agent-core architecture (contracts, strict envelope parser, deterministic turn engine, unified action runner, and first-class risk policy), then cut over runtime-critical paths.

Changed:

- Added new agent core modules:
  - `src/agent/core/contracts.ts` for unified action/turn contracts.
  - `src/agent/core/action-runner.ts` for normalized tool/skill/subagent dispatch and fallback error handling.
  - `src/agent/core/turn-engine.ts` (`runAgentTurn`) for deterministic multi-round assistant/action orchestration.
- Added strict protocol parser:
  - `src/agent/protocol/agent-envelope.ts` with strict JSON envelope parsing (`yips-agent`) and explicit parse warnings/errors.
  - kept `src/agent/protocol/tool-protocol.ts` as a compatibility shim that maps parsed actions back to legacy call lists.
- Replaced conductor internals:
  - `src/agent/conductor.ts` now acts as a compatibility shim and delegates execution to the new turn engine + action runner.
- Added first-class risk policy:
  - `src/agent/tools/action-risk-policy.ts` introducing `ActionRiskAssessment` with `riskLevel` (`none|confirm|deny`) and reason tags.
  - `src/agent/tools/tool-safety.ts` now wraps the new policy for legacy call sites.
- Updated runtime integrations:
  - `src/ui/tui/runtime-core.ts` now uses action-risk assessments for confirmation/denial flow.
  - `src/gateway/headless-conductor.ts` now uses action-risk policy for safety auto-deny.
- Added/updated tests:
  - added `tests/agent/protocol/agent-envelope.test.ts`.
  - added `tests/agent/core/turn-engine.test.ts`.
  - added `tests/agent/tools/action-risk-policy.test.ts`.
  - updated `tests/agent/conductor.test.ts` assertions for action-engine warning/history semantics.
- Updated documentation:
  - `docs/project-tree.md` with new `src/agent/core/*`, `agent-envelope`, and risk-policy paths.
  - `docs/changelog.md` with Milestone 2 hard reboot notes and runtime cutover details.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/agent/conductor.test.ts tests/agent/protocol/tool-protocol.test.ts tests/agent/protocol/agent-envelope.test.ts tests/agent/core/turn-engine.test.ts tests/agent/tools/tool-safety.test.ts tests/agent/tools/action-risk-policy.test.ts tests/gateway/headless-conductor.test.ts` — clean.
- `npm test` — clean (53 files, 411 tests).

Next:

- Remove remaining compatibility shims (`tool-protocol`, legacy `tool-safety` wrappers) once prompts/runtimes fully emit and consume `yips-agent` envelopes end-to-end.
