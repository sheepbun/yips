## 2026-02-25 11:37 MST — Exchange 169

Summary: Configured default tool-call protocol guidance so models are explicitly instructed to emit structured `yips-agent` tool envelopes on each request.

Changed:

- Added `src/agent/protocol/system-prompt.ts`:
  - introduced `TOOL_PROTOCOL_SYSTEM_PROMPT` with required `yips-agent` fenced JSON format and allowed tool/skill names.
  - introduced shared `composeChatRequestMessages(...)` that always prepends protocol guidance and optionally CODE.md context.
- Wired shared composition into runtime paths:
  - `src/ui/tui/history.ts` now delegates message composition to `#agent/protocol/system-prompt`.
  - `src/ui/tui/runtime-core.ts` now imports shared protocol-based composition.
  - `src/gateway/headless-conductor.ts` now imports shared protocol-based composition.
- Updated tests:
  - `tests/ui/tui/tui-code-context.test.ts` now asserts protocol prompt injection (with and without CODE.md context).
- Updated docs:
  - `docs/changelog.md` records protocol prompt injection under Unreleased.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-code-context.test.ts tests/gateway/headless-conductor.test.ts tests/agent/protocol/agent-envelope.test.ts` — clean.

Next:

- Optionally add a debug view/verbose output line that confirms protocol prompt injection at runtime for faster field diagnostics.
