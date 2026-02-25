## 2026-02-24 21:35 MST — Exchange 146

Summary: Implemented Milestone 3 hooks with config-driven lifecycle scripts, session/file hook integration, and soft-fail reporting.
Changed:

- Added `src/hooks.ts`:
  - `runHook(...)` for config-driven shell hook execution (`sh -lc <command>`)
  - JSON payload delivery on stdin with envelope metadata (`hook`, `eventId`, `timestamp`, `cwd`, `sessionName`, `data`)
  - `YIPS_HOOK_*` env var injection (`NAME`, `EVENT_ID`, `TIMESTAMP`, `CWD`, `SESSION_NAME`, `FILE_PATH`)
  - timeout handling and non-throwing result statuses (`ok`, `error`, `timeout`, `skipped`)
  - `formatHookFailure(...)` helper for warning text
- Extended config/types for hooks:
  - `src/types.ts`: added `HookName`, `HookConfig`, and `AppConfig.hooks`
  - `src/config.ts`: added hook defaults and normalization (timeout default `10000`, max `120000`)
- Integrated hooks in runtime:
  - `src/tool-executor.ts`: invokes `on-file-write` after successful `write_file`/`edit_file`, appends warning text on hook failures, and stores hook diagnostics in result metadata without failing the tool call
  - `src/tui.ts`: added session lifecycle hook execution for `on-session-start` and `on-session-end`
  - added shared shutdown path to run session-end hook once across exit/restart/cancel/unmount flows
  - added exported `runOnceGuarded(...)` helper used by session hook idempotence
- Added/updated tests:
  - new `tests/hooks.test.ts` for stdin/env payloads, skipped behavior, and timeout behavior
  - expanded `tests/tool-executor.test.ts` for file-write hook success/failure soft-fail behavior
  - expanded `tests/tui-startup-reset.test.ts` with `runOnceGuarded` coverage
  - updated `tests/config.test.ts` for hooks normalization
  - updated `tests/tui-busy-indicator.test.ts` for `AppConfig.hooks` compatibility
- Updated docs:
  - `docs/roadmap.md`: marked Milestone 3 `Hooks` complete
  - `docs/guides/hooks.md`: replaced planned notes with implemented config/payload/failure-contract docs
  - `docs/changelog.md`: added unreleased hooks implementation notes

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/hooks.test.ts tests/tool-executor.test.ts tests/config.test.ts tests/tui-startup-reset.test.ts` — clean
- `npm test` — clean (36 files, 331 tests)

Next:

- Implement Milestone 3 MCP client (`server registration, tool discovery, context injection`) as the next unchecked roadmap item.
