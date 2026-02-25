## 2026-02-25 12:56 MST — Exchange 176

Summary: Fixed raw JSON assistant-envelope leakage in chat output by adding unfenced-envelope fallback parsing in stream display rendering.

Changed:

- Updated `src/ui/tui/runtime-core.ts`:
  - added `extractBareEnvelopeAssistantText(rawText)` to detect/parse bare JSON envelope payloads (no fences) that include action-shape keys (`actions`, `tool_calls`, `skill_calls`, `subagent_calls`).
  - `renderAssistantStreamForDisplay(...)` now:
    - renders `assistant_text` when a bare action envelope is returned as raw JSON,
    - suppresses raw JSON object dumps in that case,
    - continues existing fenced-envelope and partial-envelope handling behavior.
- Updated tests:
  - `tests/ui/tui/tui-action-box-render.test.ts` adds coverage for unfenced raw JSON envelope fallback rendering (`assistant_text` shown, raw JSON hidden).

Validation:

- `npm run typecheck` — clean.
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/messages.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean.

Next:

- Optionally add a warning marker for bare-envelope fallback events to aid debugging model protocol drift while still preserving clean user-visible output.
