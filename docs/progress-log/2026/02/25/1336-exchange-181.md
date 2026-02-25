## 2026-02-25 13:36 MST — Exchange 181

Summary: Fixed a TUI streaming throughput regression that was causing very low observed token rates during llama.cpp streaming.
Changed:

- Updated `src/ui/tui/runtime-core.ts` streaming render path to avoid expensive envelope parsing on every incoming token.
- Added `renderAssistantStreamPreview(...)` for lightweight per-token preview rendering.
- Added `STREAM_RENDER_INTERVAL_MS = 33` and throttled per-token UI re-renders.
- Kept full `renderAssistantStreamForDisplay(...)` formatting/parsing, but now apply it once after the stream completes.
- Kept tool-protocol output behavior intact for final rendered assistant content.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean

Next:

- If throughput still dips on long outputs, profile Ink render cost for `computeVisibleLayoutSlices(...)` and reduce full-layout recomputation frequency while streaming.
