## 2026-02-24 15:11 MST — Exchange 96

Summary: Added latest assistant output throughput to chat prompt footer so status now renders `provider/model/x.x tk/s` after a response completes.
Changed:

- Updated `src/tui.ts`:
  - added runtime state field `latestOutputTokensPerSecond` with initialization and session-reset clearing.
  - added exported helpers `computeTokensPerSecond(...)` and `formatTokensPerSecond(...)`.
  - updated chat-mode prompt status builder to render slash-delimited status and append throughput when available.
  - instrumented llama request paths (streaming, non-streaming, and non-stream fallback after stream failure) to capture completion token count + generation duration and return metrics from `requestAssistantFromLlama(...)`.
  - updated assistant reply handling to persist latest throughput from the most recent successful response.
- Updated `tests/tui-busy-indicator.test.ts`:
  - added footer regression tests for throughput suffix and unresolved-model provider-only behavior.
  - added helper tests for throughput computation and `x.x tk/s` formatting.
    Validation:
- `npm test -- tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts tests/prompt-box.test.ts` — clean
- `npm test` — clean (24 files, 247 tests)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Optional interactive check with `npm run dev` to confirm the displayed `tk/s` value feels accurate against real model output cadence.
