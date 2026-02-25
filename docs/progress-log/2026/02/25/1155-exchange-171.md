## 2026-02-25 11:55 MST — Exchange 171

Summary: Implemented styled action boxes in TUI chat so raw `yips-agent` JSON blocks are no longer shown during assistant streaming; action call/result rendering now uses compact bordered boxes for tool/skill/subagent events.

Changed:

- Updated message formatting in `src/ui/messages.ts`:
  - added `formatActionCallBox(...)`.
  - added `formatActionResultBox(...)` with compact default preview and verbose-expanded detail mode.
  - added supporting action-box event types and preview/truncation helpers.
- Updated TUI runtime rendering in `src/ui/tui/runtime-core.ts`:
  - added `renderAssistantStreamForDisplay(rawText, timestamp, verbose)`.
  - streaming/fallback display path now parses envelope text and suppresses raw fenced JSON output.
  - added styled call/result box output for tool, skill, and subagent execution flows.
- Added/updated tests:
  - added `tests/ui/tui/tui-action-box-render.test.ts` for envelope-aware stream rendering.
  - expanded `tests/ui/messages.test.ts` coverage for call/result box formatters.
- Updated docs:
  - `docs/changelog.md` note for styled action box rendering behavior.

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/messages.test.ts tests/ui/tui/tui-action-box-render.test.ts tests/agent/protocol/agent-envelope.test.ts` — clean.
- `npm test -- tests/agent/conductor.test.ts tests/ui/tui/tui-history-render.test.ts tests/ui/tui/tui-code-context.test.ts` — clean.
- `npm test` — clean (54 files, 417 tests).

Next:

- Optional: add a config toggle for users who prefer legacy plain-text action diagnostics over box rendering.
