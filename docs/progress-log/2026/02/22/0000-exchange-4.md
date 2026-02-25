## 2026-02-22 00:00 MST — Exchange 4

Summary: Ported date-based git versioning from yips-cli (Python) to yips (TypeScript), fixed "llamacpp" → "llama.cpp" display names, and reorganized UI layout with top/bottom borders.
Changed:

- Created `src/version.ts`: `getGitInfo()`, `generateVersion()`, `getVersion()` producing `vYYYY.M.D-SHORTHASH` format via `git log`/`git rev-parse`, with `1.0.0` fallback.
- Created `tests/version.test.ts`: 8 tests covering formatting, git data parsing, and fallback behavior.
- Updated `src/tui.ts`:
  - Replaced hardcoded `"0.1.0"` with `await getVersion()` call.
  - Added `formatBackendName()` to display "llama.cpp" instead of "llamacpp".
  - Reorganized layout: output area, top gradient separator, prompt line, bottom border with provider/model on left and spinner on right.
  - Adjusted output area height and input field position to accommodate three-line footer.
    Validation:
- `npm run typecheck` — clean
- `npm test` — 86 tests pass (9 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Implement llama.cpp server lifecycle management (start/health-check/stop) and integrate with session startup/shutdown.
- Add an automated TUI-level integration test strategy for streaming rendering updates and retry behavior.
