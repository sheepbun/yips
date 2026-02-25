## 2026-02-24 15:14 MST — Exchange 97

Summary: Restored middle-dot separators in chat prompt footer status while keeping latest `tk/s` throughput suffix.
Changed:

- Updated `src/tui.ts`:
  - changed chat-mode prompt status joiner from `" / "` back to `" · "`.
- Updated `tests/tui-busy-indicator.test.ts`:
  - adjusted throughput footer expectation to `llama.cpp · example · 37.3 tk/s`.
  - updated status-format assertion to expect `·` separator.
    Validation:
- `npm test -- tests/tui-busy-indicator.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
  Next:
- Optional interactive check with `npm run dev` to verify footer visual spacing with the restored middle-dot separators.
