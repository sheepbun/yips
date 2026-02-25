## 2026-02-22 00:00 MST — Exchange 5

Summary: Fixed cursor position on TUI input line.
Changed:

- `src/tui.ts`: changed `inputY` from `term.height - 2` to `term.height - 1` so the `inputField` cursor aligns with the ">>> " prompt line instead of the top border separator.
  Validation:
- `npm run typecheck` — clean
- `npm test` — 86 tests pass (9 files)
  Next:
- Implement llama.cpp server lifecycle management (start/health-check/stop) and integrate with session startup/shutdown.
- Add an automated TUI-level integration test strategy for streaming rendering updates and retry behavior.
