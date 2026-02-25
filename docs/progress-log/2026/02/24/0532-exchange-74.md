## 2026-02-24 05:32 MST — Exchange 74

Summary: Implemented `/restart` command end-to-end so Yips can relaunch itself from both TUI and `--no-tui` REPL modes.
Changed:

- Updated `src/commands.ts`:
  - added `restart` to `CommandResult.action` union.
  - registered `/restart` with output `Restarting Yips.` and action `restart`.
- Updated `src/repl.ts`:
  - added `/restart` to REPL help text and command parser.
  - added `restart` handling in `applyAction(...)` (sets `state.running = false`, prints restart message).
  - changed `startRepl(...)` return type to `Promise<"exit" | "restart">` and return `restart` when requested.
- Updated `src/tui.ts`:
  - changed `startTui(...)` return type to `Promise<"exit" | "restart">`.
  - threaded an `onRestartRequested` callback through the Ink app.
  - command dispatch path now handles `result.action === "restart"` by persisting session state, signaling restart, and exiting Ink.
- Updated `src/index.ts`:
  - wrapped startup in a loop that reloads config and relaunches UI when the child mode returns `restart`.
- Updated tests:
  - `tests/commands.test.ts` now asserts `/restart` exists and returns `action: "restart"`.
  - `tests/repl.test.ts` now asserts `/restart` parsing and REPL help output.
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/repl.test.ts` — clean
- `npm test` — clean (22 files, 219 tests)
  Next:
- Optionally add a focused integration test for restart loop behavior in `src/index.ts` by mocking mode returns (`restart` then `exit`).
