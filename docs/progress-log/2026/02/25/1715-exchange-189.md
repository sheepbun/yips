## 2026-02-25 17:15 MST — Exchange 189

Summary: Implemented two-phase autonomous file mutation with staged diff previews + approval tokens across TUI and gateway, including legacy write/edit compatibility translation.

Changed:

- Added `src/agent/tools/file-change-store.ts`:
  - introduced session-scoped in-memory preview token store.
  - stores staged operation, path, before/after snapshots, diff preview, hash baseline, and expiry.
  - defaults: TTL `10m`, max entries `50`, FIFO eviction.
- Refactored `src/agent/tools/tool-executor.ts`:
  - added `preview_write_file` and `preview_edit_file` (no filesystem mutation).
  - added `apply_file_change` token apply path with:
    - token validation,
    - stale-content hash guard,
    - working-zone recheck,
    - atomic write apply,
    - `on-file-write` hook execution only on successful apply.
  - translated legacy `write_file` and `edit_file` to preview-only behavior with `metadata.legacyTranslated = true`.
  - extended `ToolExecutorContext` to require `fileChangeStore`.
- Updated tool/types/protocol:
  - extended tool union in `src/types/app-types.ts` with `preview_write_file`, `preview_edit_file`, `apply_file_change`.
  - expanded allow-list in `src/agent/protocol/agent-envelope.ts`.
  - updated `src/agent/protocol/system-prompt.ts` with canonical preview/apply guidance and legacy alias behavior.
- Updated risk + runtime wiring:
  - `src/agent/tools/action-risk-policy.ts`: `apply_file_change` now always classifies as `confirm` (`file-mutation`).
  - `src/ui/tui/runtime-core.ts`: now provisions and passes a per-runtime `FileChangeStore` to tool execution.
  - `src/gateway/headless-conductor.ts`:
    - now provisions one `FileChangeStore` per gateway session state,
    - passes store into tool execution for both main and subagent tool paths,
    - keeps auto-deny for confirm-risk calls except explicit `apply_file_change` token apply.
  - `src/ui/messages.ts`: added call labels for new tool names.
- Added/updated tests:
  - new `tests/agent/protocol/system-prompt.test.ts`.
  - rewrote `tests/agent/tools/tool-executor.test.ts` for staged/apply flow, invalid/expired/stale tokens, legacy translation, and hook timing.
  - updated `tests/agent/tools/action-risk-policy.test.ts` for `apply_file_change` confirmation risk.
  - updated `tests/agent/protocol/tool-protocol.test.ts` to include new tool parsing.
  - expanded `tests/gateway/headless-conductor.test.ts` for preview->apply success and invalid/expired apply behavior.
- Updated docs:
  - `docs/guides/tool-calls.md` (allowed tools, canonical two-phase flow, gateway behavior note).
  - `docs/architecture.md` (file mutation staging and gateway exception semantics).
  - `docs/roadmap.md` (clarified milestone item wording).
  - `docs/changelog.md` (unreleased entries for two-phase mutation changes).

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/agent/tools/tool-executor.test.ts tests/agent/tools/action-risk-policy.test.ts tests/agent/protocol/tool-protocol.test.ts tests/agent/protocol/system-prompt.test.ts tests/gateway/headless-conductor.test.ts tests/ui/messages.test.ts` — clean.
- `npm test` — 1 unrelated failing pre-existing test:
  - `tests/llm/llama-server.test.ts > startLlamaServer > returns process-exited when spawned binary exits immediately`

Next:

- Stabilize or isolate the flaky/non-deterministic llama-server process-exit test so full-suite CI remains deterministic.
