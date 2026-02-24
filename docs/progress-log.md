# Progress Log

Rolling implementation handoff between exchanges. New entries append at the end.

## 2026-02-22 23:55 UTC - Exchange 1

Summary: Implemented Milestone 0 bootstrap from docs into a runnable TypeScript foundation.
Changed:

- Added project scaffold and tooling files: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `.eslintrc.cjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`.
- Added source modules: `src/index.ts`, `src/repl.ts`, `src/config.ts`, `src/types.ts`.
- Added tests: `tests/repl.test.ts`, `tests/config.test.ts`.
- Added CI workflow: `.github/workflows/ci.yml` (`npm ci`, typecheck, test, format check).
- Updated docs and governance: `AGENTS.md`, `docs/README.md`, `docs/guides/getting-started.md`, `docs/contributing.md`, `docs/roadmap.md`, `docs/stack.md`, `docs/changelog.md`.
  Validation:
- Installed dependencies with `npm install` (escalated permissions).
- Ran `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` successfully.
  Next:
- Start Milestone 1 by evaluating the first TUI framework prototype.
- Expand slash command parsing beyond `/help` and `/exit` once TUI direction is selected.

## 2026-02-22 — Exchange 2

Summary: Implemented Milestone 1 TUI with terminal-kit, porting the yips-cli UI.
Changed:

- Installed `terminal-kit` (runtime) and `@types/terminal-kit` (dev).
- Created `src/colors.ts`: color palette constants, `interpolateColor`, `horizontalGradient`, `diagonalGradient`, truecolor markup helpers.
- Created `src/title-box.ts`: responsive title box with ASCII YIPS logo, 4 layout modes (full ≥80, single 60-79, compact 45-59, minimal <45), gradient Unicode borders.
- Created `src/messages.ts`: `formatUserMessage`, `formatAssistantMessage`, `formatErrorMessage`, `formatWarningMessage`, `formatSuccessMessage`, `formatDimMessage`.
- Created `src/spinner.ts`: `PulsingSpinner` class with 8-frame braille animation, sine-wave color oscillation, elapsed time display.
- Created `src/commands.ts`: `CommandRegistry` with register/dispatch, `parseCommand`, `createDefaultRegistry` with `/help`, `/exit`, `/quit`, `/clear`, `/model`, `/stream`, `/verbose`.
- Created `src/tui.ts`: terminal-kit alternate screen TUI with three-zone layout (scrollable output, status bar, input line), Ctrl+C shutdown, resize handling.
- Updated `src/index.ts`: launches TUI by default, REPL fallback for `--no-tui` or non-TTY.
- Added `TuiOptions` to `src/types.ts`.
- Created tests: `tests/colors.test.ts` (17), `tests/title-box.test.ts` (10), `tests/messages.test.ts` (7), `tests/spinner.test.ts` (8), `tests/commands.test.ts` (18).
- Updated `docs/roadmap.md`: TUI framework decided, TUI layout + slash commands + loading indicators checked off.
- Updated `docs/stack.md`: terminal-kit moved from Open to Decided.
- Updated `docs/changelog.md` with Milestone 1 entries.
  Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — 69 tests pass (7 files)
- `npm run build` — compiles cleanly
- `npm run format:check` — clean
  Next:
- llama.cpp integration: subprocess management, OpenAI-compatible API requests.
- Streaming display: token-by-token rendering in the TUI output area.
- Conversation history: in-memory message list and context assembly.

## 2026-02-23 01:05 UTC — Exchange 3

Summary: Stabilized terminal rendering and completed Milestone 1 backend chat path (llama.cpp requests, streaming, history).
Changed:

- Fixed terminal-kit truecolor markup usage in `src/colors.ts` (`^[#rrggbb]...^:`), resolving literal color token artifacts in `npm run dev`.
- Updated markup stripping in `src/title-box.ts` for current color syntax.
- Added `src/llama-client.ts` with OpenAI-compatible `/v1/chat/completions` support:
  - non-streaming chat completion requests
  - SSE streaming token parsing
  - timeout/network/error handling
- Extended config schema in `src/types.ts` and `src/config.ts`:
  - added `llamaBaseUrl` and `model`
  - added optional env overrides (`YIPS_LLAMA_BASE_URL`, `YIPS_MODEL`)
- Expanded slash command behavior in `src/commands.ts`:
  - `/model` now shows current model and sets active runtime model
  - `/new` added as alias for `/clear`
- Reworked `src/tui.ts` message flow:
  - replaced echo path with llama.cpp-backed chat requests
  - token-by-token in-place streaming rendering for assistant responses
  - retry-once non-stream fallback when streaming fails
  - in-memory conversation history sent with each request
  - `/clear`/`/new` now resets conversation history and message count
- Added/updated tests:
  - new `tests/llama-client.test.ts` (5 tests)
  - updated `tests/config.test.ts` for new config fields/env overrides
  - updated markup and command tests (`tests/colors.test.ts`, `tests/messages.test.ts`, `tests/title-box.test.ts`, `tests/commands.test.ts`)
- Updated docs:
  - `docs/roadmap.md` Milestone 1 backend/stream/history items marked complete
  - `docs/stack.md` markup syntax corrected and llama.cpp usage updated
  - `docs/guides/getting-started.md` refreshed for TUI + backend behavior
  - `docs/changelog.md` updated with new backend/rendering/config changes
    Validation:
- `npm run lint`
- `npm run typecheck`
- `npm test` (76 passing)
- `npm run build`
- `npm run format:check`
- Manual `npm run dev` launch confirms color markup now renders as ANSI truecolor (no literal `ff1493`-style artifacts).
  Next:
- Implement llama.cpp server lifecycle management (start/health-check/stop) and integrate with session startup/shutdown.
- Add an automated TUI-level integration test strategy for streaming rendering updates and retry behavior.

## 2026-02-22 — Exchange 4

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

## 2026-02-22 — Exchange 5

Summary: Fixed cursor position on TUI input line.
Changed:

- `src/tui.ts`: changed `inputY` from `term.height - 2` to `term.height - 1` so the `inputField` cursor aligns with the ">>> " prompt line instead of the top border separator.
  Validation:
- `npm run typecheck` — clean
- `npm test` — 86 tests pass (9 files)
  Next:
- Implement llama.cpp server lifecycle management (start/health-check/stop) and integrate with session startup/shutdown.
- Add an automated TUI-level integration test strategy for streaming rendering updates and retry behavior.

## 2026-02-23 — Exchange 6

Summary: Replaced the flat prompt bar with a rounded prompt box and moved provider/model status to the bottom-right border.
Changed:

- Added `src/prompt-box.ts` with pure prompt-box layout builders that:
  - construct rounded top/middle/bottom lines
  - right-align provider/model status inside the bottom border
  - clip status safely for narrow terminal widths
- Updated `src/tui.ts`:
  - replaced separate status bar + separator + prompt line rendering with a unified `renderPromptBox()`
  - draws `╭╮`, `││`, and `╰╯` prompt box rows at the bottom of the screen
  - keeps `>>> ` in pink on the input row
  - renders provider/model status in the bottom-right border
  - removes spinner text from border rendering
- Added `tests/prompt-box.test.ts` (5 tests) covering rounded geometry, right alignment, clipping, and narrow-width behavior.
  Validation:
- `npm run typecheck` — clean
- `npm test` — 91 tests pass (10 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Add a lightweight TUI integration-style test harness for footer/prompt rendering contracts.
- Evaluate whether status should optionally include spinner state without disrupting right-aligned border layout.

## 2026-02-23 — Exchange 7

Summary: Added a lightweight integration-style TUI resize harness to validate prompt-box rendering contracts.
Changed:

- Added `tests/tui-resize-render.test.ts`:
  - mocks `terminal-kit` terminal APIs (`moveTo`, `eraseLine`, `markupOnly`, `on`)
  - registers resize handling through `setupResizeHandler()`
  - triggers synthetic resize events and validates rendered prompt-box lines after markup stripping
  - verifies rounded geometry, right-aligned provider/model status, narrow-width clipping, and erase-line call counts
    Validation:
- `npm run test -- tests/tui-resize-render.test.ts` — clean
- `npm test` — 93 tests pass (11 files)
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Extend resize harness to cover a non-`llamacpp` backend label path (`claude`) for status rendering parity.
- Consider adding a focused prompt-cursor alignment check if input-field behavior is refactored behind a test seam.

## 2026-02-23 — Exchange 8

Summary: Fixed border overwrite by replacing `inputField()` with a bounded multiline prompt composer that keeps wrapped input inside the prompt box.
Changed:

- Added `src/prompt-composer.ts`:
  - pure layout builder (`buildPromptComposerLayout`) for prefix-aware wrapping inside prompt interior width
  - `PromptComposer` state machine handling insert/edit/navigation, multiline cursor movement, history traversal, and slash autocomplete
- Updated `src/prompt-box.ts`:
  - added `buildPromptBoxFrame(width, statusText, middleRowCount)` for dynamic-height prompt boxes
  - kept `buildPromptBoxLayout(...)` for single-row compatibility
- Reworked `src/tui.ts`:
  - removed `term.inputField(...)` usage
  - integrated custom key-driven composer loop
  - prompt box now grows to multiple middle rows as content wraps and always redraws bounded borders
  - prompt box shrinks back to one row after submit/cancel by clearing composer state
  - resize path now recomputes composer width and re-renders prompt/cursor in-box
  - preserved command parsing, history recording, and backend request flow
- Added/updated tests:
  - new `tests/prompt-composer.test.ts` (5 tests)
  - expanded `tests/prompt-box.test.ts` to cover dynamic frame rows/status clipping
  - expanded `tests/tui-resize-render.test.ts` to verify wrapped prompt content stays border-contained
    Validation:
- `npm run typecheck` — clean
- `npm test` — 101 tests pass (12 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Add a targeted integration test for interactive autocomplete menu selection in the composer loop.
- Add a parity check for non-llama backend status labels during multiline input rendering.

## 2026-02-23 — Exchange 9

Summary: Added newline insertion in the prompt box for `Ctrl+Enter` while preserving plain `Enter` submit behavior.
Changed:

- Updated `src/prompt-composer.ts`:
  - `handleKey()` now treats `CTRL_ENTER` and `CTRL_M` as newline insertion (`\n`) events
  - plain `ENTER`/`KP_ENTER` still submit the prompt
  - wrapping engine now treats embedded `\n` as a hard line break and maps cursor rows/columns accordingly
- Updated `tests/prompt-composer.test.ts`:
  - added hard-line-break layout test for newline-containing text
  - added key-path test verifying `CTRL_ENTER`/`CTRL_M` insert newline and `ENTER` still submits
    Validation:
- `npm run typecheck` — clean
- `npm test` — 103 tests pass (12 files)
- `npm run lint` — clean
- `npm run format:check` — clean

## 2026-02-24 22:32 UTC — Exchange 10

Summary: Added model-aware autocomplete for operator commands so `/model` and `/nick` complete local on-device models by ID/repo/file aliases.
Changed:

- Updated `src/prompt-composer.ts`:
  - added context-aware autocomplete routing:
    - slash command completion for `/...`
    - model target completion for `/model <arg1>` and `/nick <arg1>`
  - added `ModelAutocompleteCandidate` support with canonical `value` + alias matching
  - added `setModelAutocompleteCandidates(...)` to refresh model suggestions at runtime
  - expanded token parsing logic to support empty argument completion (e.g. `/model `)
- Updated `src/tui.ts`:
  - added `buildModelAutocompleteCandidates(...)` to build aliases from local model IDs (repo path, filename, filename stem)
  - wired composer creation to pass command and model autocomplete sources
  - added async local model autocomplete refresh on startup
  - refreshes model autocomplete after successful downloader completion and local model deletion
  - refreshes model autocomplete after direct `/download` and `/dl` command dispatch
  - added `Tab` acceptance behavior when autocomplete menu is open
  - updated autocomplete overlay fallback label for non-command suggestions to `Local model`
- Updated tests:
  - expanded `tests/prompt-composer.test.ts` for `/model` and `/nick` operator completion contexts, alias matching, empty-arg behavior, and runtime refresh behavior
  - added `tests/tui-model-autocomplete.test.ts` for model alias candidate generation and overlay rendering for local model suggestions
Validation:

- `npm run typecheck` — clean
- `npm test` — 254 tests pass (25 files)
- `npm run lint` — clean
- `npm run format:check` — fails (pre-existing repo-wide formatting drift across many files, not introduced by this exchange)
Next:

- Consider adding an integration-style input-loop test that explicitly asserts `Tab` acceptance in chat mode with an open autocomplete menu.
  Next:
- Add an integration-level key-event harness case to verify newline insertion path through `readPromptInput()` and render loop.
- Evaluate optional UX hint in prompt footer for newline shortcut discoverability.

## 2026-02-23 — Exchange 10

Summary: Hardened modified-Enter handling across terminal variants so newline insertion works when terminals emit non-standard `Ctrl+Enter` sequences.
Changed:

- Updated `src/prompt-composer.ts`:
  - newline insertion now accepts `ALT_ENTER`, `SHIFT_ENTER`, and `CTRL_SHIFT_ENTER` in addition to `CTRL_ENTER`/`CTRL_M`
  - newline-aware layout logic retained with hard line breaks preserved in wrapped rows
- Updated `src/tui.ts`:
  - added unknown-sequence parser for modified Enter CSI variants (`\x1b[13;5u`, `\x1b[13;5~`, `\x1b[27;5;13~`, `\x1b[27;13;5~`)
  - while composing, matching unknown sequences are translated to `CTRL_ENTER` newline insertion and redrawn in-box
  - prompt cleanup now unregisters both `key` and `unknown` listeners
    Validation:
- `npm run typecheck` — clean
- `npm test` — 103 tests pass (12 files)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Add a focused integration test that injects unknown modified-enter sequences into the composer loop.
- Consider exposing active key-sequence diagnostics in a debug mode to simplify terminal-specific input support.

## 2026-02-23 — Exchange 11

Summary: Restricted multiline insertion to explicit `Ctrl+Enter` and restored `Ctrl+M` to submit behavior.
Changed:

- Updated `src/prompt-composer.ts`:
  - `CTRL_M` now follows submit behavior with `ENTER`/`KP_ENTER`.
  - Removed newline insertion aliases for `ALT_ENTER`, `SHIFT_ENTER`, and `CTRL_SHIFT_ENTER`.
  - Newline insertion remains only on `CTRL_ENTER`.
- Updated `tests/prompt-composer.test.ts`:
  - revised modified-enter test to assert newline insertion only for `CTRL_ENTER`
  - added assertions that `SHIFT_ENTER`/`ALT_ENTER`/`CTRL_SHIFT_ENTER` do not insert newlines
  - added assertion that `CTRL_M` submits the current text
    Validation:
- `npm test -- tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm run typecheck` — clean
  Next:
- Add a focused integration test that exercises `readPromptInput()` key handling for `CTRL_M` and `CTRL_ENTER` end-to-end.

## 2026-02-23 — Exchange 12

Summary: Restored Ctrl+Enter newline behavior across more terminal variants by normalizing key names and broadening unknown-sequence detection.
Changed:

- Updated `src/tui.ts`:
  - added `normalizePromptComposerKey()` to map ctrl-enter aliases (including `CTRL_M` and ctrl-modified enter variants) to `CTRL_ENTER`
  - replaced fixed-sequence matching with parser-based `isCtrlEnterUnknownSequence()` handling CSI-u and modifyOtherKeys forms
  - Ctrl modifier detection now uses modifier bitmask semantics, so `Ctrl+Shift+Enter` and `Ctrl+Alt+Enter` variants are accepted as ctrl-enter newline inputs
  - kept plain `ENTER` submit path unchanged in composer-level behavior
- Added `tests/tui-keys.test.ts`:
  - validates key-name normalization for ctrl-enter aliases
  - validates unknown-sequence parsing for ctrl-enter across multiple encodings
  - validates rejection of non-ctrl and non-enter sequences
    Validation:
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm run lint` — clean
- `npm run typecheck` — clean
  Next:
- If a terminal still fails to emit a distinguishable ctrl-enter sequence, add optional debug logging for incoming key/unknown events to capture raw sequences and map them explicitly.

## 2026-02-23 — Exchange 13

Summary: Migrated the interactive TUI from terminal-kit to Ink while preserving command dispatch, llama.cpp chat flow, and multiline prompt composition.
Changed:

- Updated dependencies:
  - removed `terminal-kit` and `@types/terminal-kit`
  - added `ink` and `react` (plus `@types/react` in dev dependencies)
- Updated TypeScript module settings in `tsconfig.json`:
  - `module` and `moduleResolution` switched to `Node16` so runtime `import("ink")` stays a native dynamic import in emitted CommonJS
- Replaced `src/tui.ts` implementation:
  - removed terminal-kit fullscreen/cursor drawing event loop
  - added Ink-based app renderer (`startTui()` now dynamically loads Ink and mounts a React component)
  - preserved prompt composer editing model (`PromptComposer`) with multiline support and Enter/CTRL+Enter behavior
  - preserved slash command handling (`/help`, `/clear`, `/model`, `/stream`, `/verbose`, `/exit`)
  - preserved llama.cpp request path including streaming updates and non-stream retry fallback
  - added pure prompt-frame helper `buildPromptRenderLines(...)` for deterministic render testing
  - retained and exported Ctrl+Enter sequence helpers (`normalizePromptComposerKey`, `isCtrlEnterUnknownSequence`)
- Updated tests:
  - rewrote `tests/tui-resize-render.test.ts` to validate prompt frame rendering via `buildPromptRenderLines(...)` instead of terminal-kit mocks
  - kept key-sequence coverage in `tests/tui-keys.test.ts`
- Updated docs for TUI framework change:
  - `docs/stack.md` (TUI framework section now Ink)
  - `docs/roadmap.md` decision log row for TUI framework
  - `docs/guides/getting-started.md` first-run TUI description
  - `docs/changelog.md` unreleased notes for terminal-kit → Ink migration
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (108 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Manually test interactive behavior in a real terminal (`npm run dev`) focusing on Ctrl+Enter newline insertion across your terminal emulator/keymap.
- If any terminal still fails to emit distinguishable Ctrl+Enter input, add an optional debug mode that logs raw stdin sequences for quick per-terminal mapping fixes.

## 2026-02-23 — Exchange 14

Summary: Fixed Ink migration regressions for prompt-box border stability, backspace handling, and missing colors.
Changed:

- Updated `src/colors.ts`:
  - migrated styling output to ANSI truecolor escape sequences (replacing terminal-kit markup output)
  - retained existing color helper APIs (`colorText`, `horizontalGradient`, `diagonalGradient`, etc.)
  - added non-regex ANSI stripping helper (`stripAnsi`) for plain-text assertions/utilities
- Updated `src/title-box.ts`:
  - `stripMarkup()` now strips ANSI output (and still strips legacy terminal-kit tokens for compatibility)
- Updated `src/messages.ts` comment to reflect ANSI-based styling pipeline
- Updated `src/tui.ts`:
  - restored color rendering in Ink by removing output-line style stripping
  - prompt frame rendering now applies ANSI colors/gradients to borders and prompt prefix
  - fixed prompt-box right-edge drift by switching cursor rendering from insertion to in-place replacement (`withCursorAt`) and preserving fixed inner width
  - expanded key normalization for destructive input variants (`Backspace`, `DEL` byte, `Ctrl+H`) in `mapInkKeyToComposerKey()`
  - exported `mapInkKeyToComposerKey()` for focused key-path tests
- Updated tests:
  - `tests/colors.test.ts` updated for ANSI assertions
  - `tests/messages.test.ts` updated for ANSI assertions
  - `tests/title-box.test.ts` added ANSI stripping coverage
  - `tests/tui-resize-render.test.ts` now strips ANSI before geometry assertions while verifying styled output is emitted
  - `tests/tui-keys.test.ts` added backspace variant mapping checks
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (110 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Manually verify in a real terminal (`npm run dev`) that prompt border remains visually stable during rapid typing/backspacing and multiline cursor movement.
- If any terminal still emits unusual backspace/control sequences, extend `mapInkKeyToComposerKey()` with targeted normalization based on captured key/input data.

## 2026-02-23 04:19 UTC — Exchange 15

Summary: Verified the Ink regression-fix implementation in the current workspace and confirmed all quality gates are passing.
Changed:

- No additional code changes were required in this exchange.
- Confirmed the Exchange 14 fixes are present in source:
  - ANSI styling pipeline (`src/colors.ts`, `src/title-box.ts`, `src/messages.ts`)
  - prompt frame/cursor/backspace handling (`src/tui.ts`)
  - regression tests (`tests/colors.test.ts`, `tests/messages.test.ts`, `tests/title-box.test.ts`, `tests/tui-resize-render.test.ts`, `tests/tui-keys.test.ts`)
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (110 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Manual interactive verification in the user’s terminal remains the final step for visual behavior nuances (border stability under rapid edits/backspacing).

## 2026-02-23 04:24 UTC — Exchange 16

Summary: Fixed remaining Ink backspace instability by handling raw backspace bytes directly and filtering control characters from prompt text insertion.
Changed:

- Updated `src/tui.ts`:
  - added `countBackspaceUnknownSequence(chunk)` to detect/count raw backspace bytes (`0x08`, `0x7f`) from stdin
  - added `hasControlCharacters(input)` and gated character insertion so control bytes are ignored rather than inserted into prompt text
  - added raw-stdin backspace effect that dispatches `BACKSPACE` directly to `PromptComposer` and forces redraw
  - added `backspacePendingRef` de-dupe path so backspace is not applied twice when both stdin and Ink key events fire
- Updated `tests/tui-keys.test.ts`:
  - added coverage for `countBackspaceUnknownSequence(...)`
  - added coverage for `hasControlCharacters(...)`
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/tui-resize-render.test.ts tests/prompt-composer.test.ts` — clean
- `npm test` — clean (114 passing)
- `npm run build` — clean
  Next:
- Manually verify in the interactive terminal that rapid backspacing no longer inserts control bytes or causes right-border drift.

## 2026-02-23 04:29 UTC — Exchange 17

Summary: Restored Ctrl+Enter newline insertion by making raw-sequence parsing resilient to chunked stdin delivery and adding extra key-path normalization.
Changed:

- Updated `src/tui.ts`:
  - added `consumeCtrlEnterUnknownSequence(chunk, carry)` to parse ctrl-enter CSI sequences across split stdin chunks (with carry state)
  - wired ctrl-enter stdin handler to use carry-aware parsing and dispatch one newline per detected sequence
  - added `ctrlEnterCarryRef` to persist parser carry between stdin events
  - expanded `mapInkKeyToComposerKey(...)` to map raw ctrl-enter sequence strings directly and to accept ctrl-modified carriage-return/newline bytes
- Updated `tests/tui-keys.test.ts`:
  - added coverage for `consumeCtrlEnterUnknownSequence(...)` complete-chunk and split-chunk paths
  - added mapping assertions for ctrl-enter raw encoding and ctrl-modified carriage return
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (117 passing)
- `npm run build` — clean
  Next:
- Re-test interactively (`npm run dev`) to confirm Ctrl+Enter inserts newlines reliably in your terminal after this chunked-sequence handling fix.

## 2026-02-23 04:32 UTC — Exchange 18

Summary: Broadened modified-enter detection so terminals that encode Ctrl+Enter as other modified Enter variants still insert a newline.
Changed:

- Updated `src/tui.ts`:
  - broadened unknown-sequence modifier matching to treat any modified Enter sequence (not just ctrl-bit variants) as newline input
  - expanded Enter mapping in `mapInkKeyToComposerKey(...)`:
    - `\r`/`\n` with modifiers (`ctrl`/`shift`/`meta`) now map to `CTRL_ENTER`
    - unmodified `\r`/`\n` now map to `ENTER`
    - `key.return` with modifier flags now maps to `CTRL_ENTER`
    - added `Ctrl+J` fallback mapping to `CTRL_ENTER`
  - included LF keycode (`10`) in modified-enter keycode handling
- Updated `tests/tui-keys.test.ts`:
  - adjusted unknown-sequence expectations for modified-enter variants
  - added assertions for modified newline-byte mapping and `Ctrl+J` mapping
  - added assertions for unmodified `\r`/`\n` mapping to `ENTER`
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (118 passing)
- `npm run build` — clean
  Next:
- Re-test Ctrl+Enter interactively in your terminal; if it still fails, add temporary key/byte debug output to capture your exact terminal encoding and map it directly.

## 2026-02-23 04:36 UTC — Exchange 19

Summary: Added keypad-style modified Enter sequence support and built-in key-debug capture mode to diagnose terminal-specific Ctrl+Enter encodings.
Changed:

- Updated `src/tui.ts`:
  - added support for CSI `...M` modified keypad-enter sequences in ctrl-enter detection (`\x1b[1;5M`-style)
  - extended chunk parser terminator support to include `M` so split keypad-enter sequences are recognized
  - added optional debug mode via `YIPS_DEBUG_KEYS=1`:
    - logs raw stdin chunk bytes and escaped text forms
    - logs Ink key event fields (`input`, `return`, `ctrl`, `shift`, `meta`)
- Updated `tests/tui-keys.test.ts`:
  - added CSI `M` sequence assertions for direct detection and key mapping
  - updated chunk-consumption multi-sequence assertion to include `M`-terminated sequence parsing
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (118 passing)
- `npm run build` — clean
  Next:
- Run with debug enabled (`YIPS_DEBUG_KEYS=1 npm run dev`) and capture the `[debug stdin]` + `[debug key]` lines emitted when pressing Ctrl+Enter to map any remaining terminal-specific encoding.

## 2026-02-23 04:47 UTC — Exchange 20

Summary: Reworked prompt input handling around a single raw-stdin input engine, removing the mixed event pipeline that caused newline/backspace instability.
Changed:

- Added `src/input-engine.ts`:
  - new `InputAction` contract for semantic prompt actions (`insert`, `submit`, `newline`, navigation, delete/backspace, cancel)
  - new `InputEngine` class that parses raw stdin bytes deterministically with carry-safe CSI handling
  - CSI parsing supports unmodified/modified Enter, legacy modifyOtherKeys Enter forms, arrows/home/end/delete, and control-byte handling
- Refactored `src/tui.ts`:
  - integrated `InputEngine` as the sole prompt-editing input source
  - removed mixed `useInput` + multiple raw-listener editing paths in favor of one `stdin.on("data")` action loop
  - added `applyInputAction(...)` to map engine actions into `PromptComposer` events
  - retained optional `YIPS_DEBUG_KEYS=1` debug output, now showing parsed action summaries per chunk
- Replaced old key-mapping regression tests:
  - removed `tests/tui-keys.test.ts` coverage tied to old TUI key-mapping helpers
  - added `tests/input-engine.test.ts` for the new input engine behavior (including split-chunk sequences and UTF-8 boundary handling)
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (113 passing)
- `npm run build` — clean
- `npm run format:check` — clean
- `printf '/exit\n' | npm run dev -- --no-tui` — clean
  Next:
- Re-test interactive TUI behavior (`npm run dev`) in the user’s terminal to confirm `Ctrl+Enter` newline and `Enter` submit now behave consistently with the new single-path input engine.

## 2026-02-23 04:53 UTC — Exchange 21

Summary: Extended raw-stdin enter parsing with additional terminal fallbacks likely used by modified-enter keybindings.
Changed:

- Updated `src/input-engine.ts`:
  - added non-CSI modified-enter fallback handling for `ESC+CR` and `ESC+LF` (treated as newline)
  - added SS3 keypad-enter handling (`ESC O M`) mapped to submit
  - changed bare `LF` handling to newline while keeping `CR` as submit (`CRLF` remains submit via CR path)
- Updated `tests/input-engine.test.ts`:
  - adjusted LF expectation from submit to newline
  - added coverage for `ESC+CR` / `ESC+LF` newline mapping
  - added coverage for SS3 keypad-enter submit mapping
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/input-engine.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean
- `npm test` — clean (115 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Re-test interactive behavior in the user terminal (`npm run dev`) and verify:
  - `Enter` submits
  - `Ctrl+Enter` inserts newline (including terminal variants that encode modified-enter as `LF`, `ESC+CR/LF`, or CSI/SS3 forms).

## 2026-02-23 20:33 UTC — Exchange 22

Summary: Added in-app key diagnostics guidance and explicit Alacritty Ctrl+Enter troubleshooting while preserving Enter submit / Ctrl+Enter newline behavior.
Changed:

- Updated `src/commands.ts`:
  - added `/keys` command with built-in key diagnostics instructions
  - `/help` now includes `/keys` via default registry listing
- Updated `src/tui.ts`:
  - added `isAmbiguousPlainEnterChunk(...)` helper for debug-time detection of plain CR submit chunks
  - when `YIPS_DEBUG_KEYS=1`, now emits a warning if input indicates ambiguous plain-CR Enter encoding that can make Ctrl+Enter indistinguishable from Enter
- Updated docs:
  - `docs/guides/getting-started.md` now includes a Multiline Key Troubleshooting section
  - added Alacritty mapping example for Ctrl+Enter (`\u001b[13;5u`) and verification flow using debug mode
  - `docs/changelog.md` updated with `/keys` and debug/docs improvements
- Updated tests:
  - `tests/commands.test.ts` now validates `/keys` registration and diagnostics output content
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/commands.test.ts tests/input-engine.test.ts` — clean
- `npm test` — clean (116 passing)
- `npm run lint` — clean
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Verify on the target Arch+i3+Alacritty environment:
  - run `YIPS_DEBUG_KEYS=1 npm run dev`
  - compare debug output for Enter vs Ctrl+Enter
  - if needed, apply the documented Alacritty mapping and re-test newline insertion behavior.

## 2026-02-23 20:40 UTC — Exchange 23

Summary: Implemented follow-up Ctrl+Enter terminal-mapping plan by adding fallback escape guidance for Alacritty when plain-CR ambiguity persists.
Changed:

- Updated `src/commands.ts`:
  - expanded `/keys` diagnostics text to include an alternate supported mapping (`\u001b[13;5~`) in addition to CSI-u (`\u001b[13;5u`)
- Updated `docs/guides/getting-started.md`:
  - added alternate Alacritty `Ctrl+Enter` mapping snippet using `\u001b[13;5~` for environments where CSI-u mapping does not resolve CR ambiguity
- Updated `tests/commands.test.ts`:
  - `/keys` output assertion now validates both supported mapping strings
- Updated `docs/changelog.md`:
  - added note for the alternate Alacritty fallback mapping guidance
    Validation:
- `npm test -- tests/commands.test.ts` — clean
- `npm run typecheck` — clean
  Next:
- Re-test in native Alacritty/i3 with `YIPS_DEBUG_KEYS=1 npm run dev`.
- If `Ctrl+Enter` still appears as plain CR submit, share the emitted `[debug stdin]` line(s) for direct parser extension.

## 2026-02-23 21:32 UTC — Exchange 24

Summary: Refactored TUI viewport rendering so the title box is fixed at the top and the prompt box remains anchored at the bottom.
Changed:

- Updated `src/tui.ts`:
  - removed title-box insertion into `outputLines` (deleted session-header append path)
  - simplified `resetSession(...)` to clear conversation/output state only
  - added exported `computeVisibleLayoutSlices(...)` helper to allocate fixed top title, middle output, and fixed bottom prompt rows based on terminal height
  - integrated live per-render title computation (`renderTitleBox(...)`) so model/backend/session metadata updates are reflected immediately
  - changed final Ink node composition order to always render `title -> output -> prompt`
  - fixed zero-capacity middle slice edge case (`slice(-0)`) by returning empty output rows when no middle viewport space exists
- Updated `tests/tui-resize-render.test.ts`:
  - added `computeVisibleLayoutSlices` coverage for: - normal height allocation - short-height behavior preserving prompt rows first - prompt-taller-than-terminal clipping behavior
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (119 passing)
  Next:
- Perform an interactive visual pass with `npm run dev` to confirm top/bottom anchoring behavior across manual terminal resizes and multiline prompt growth.

## 2026-02-23 21:35 UTC — Exchange 25

Summary: Fixed prompt anchoring regression by padding the middle viewport so the prompt always renders on the terminal’s bottom rows.
Changed:

- Updated `src/tui.ts`:
  - adjusted `computeVisibleLayoutSlices(...)` to pad middle output rows with blanks when output history is shorter than available middle height
  - this guarantees `title + middle + prompt` always fills the visible row budget, keeping prompt rows bottom-anchored
- Updated `tests/tui-resize-render.test.ts`:
  - added `pads the middle viewport so prompt stays anchored at the bottom` regression test
  - validates blank middle-row padding and exact total row occupancy
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Run `npm run dev` and manually resize the terminal to verify the prompt remains fixed to the bottom under live interaction.

## 2026-02-23 21:39 UTC — Exchange 26

Summary: Updated viewport behavior so output can scroll the title box off-screen while keeping the prompt anchored to the bottom.
Changed:

- Updated `src/tui.ts`:
  - changed `computeVisibleLayoutSlices(...)` to treat the upper region as a single scrollable stack of `title + output`
  - upper viewport now renders the tail of that stack, allowing output growth to progressively displace and eventually hide title lines
  - retained top padding for sparse history so total rows still fill terminal height and prompt remains bottom-anchored
- Updated `tests/tui-resize-render.test.ts`:
  - revised slice expectations to reflect stacked upper-tail behavior
  - added/updated coverage verifying output can fully bump title off-screen
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Verify live UX in `npm run dev` to confirm title displacement feels correct during long conversations and terminal resizes.

## 2026-02-23 21:41 UTC — Exchange 27

Summary: Adjusted upper-viewport padding so the title starts at the top initially, while still allowing output growth to push it off-screen later.
Changed:

- Updated `src/tui.ts`:
  - refined `computeVisibleLayoutSlices(...)` for non-overflow cases to place blank padding after `title + output` (not before), keeping title top-aligned at startup
  - added explicit `upperRowCount === 0` guard so prompt-only height does not render title/output rows
- Updated `tests/tui-resize-render.test.ts`:
  - updated padding regression expectation to assert title-first rendering with trailing upper-region blanks
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Validate interactively with `npm run dev` that initial render shows title at top and long output subsequently displaces it as intended.

## 2026-02-23 21:44 UTC — Exchange 28

Summary: Updated upper-viewport fill behavior so chat output grows upward from the prompt into empty space before reaching the title box.
Changed:

- Updated `src/tui.ts`:
  - in non-overflow upper viewport cases, `computeVisibleLayoutSlices(...)` now returns `title + leading-gap + output` (instead of trailing-gap)
  - this bottom-aligns output directly above the prompt, so new chat lines consume padding upward toward the title
- Updated `tests/tui-resize-render.test.ts`:
  - revised non-overflow padding expectation to enforce leading blank rows before output
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
  Next:
- Run an interactive `npm run dev` check to confirm visual growth direction matches expectation during active conversation.

## 2026-02-23 22:28 UTC — Exchange 29

Summary: Made all prompt-authored user text render in `#ffccff` pink, including wrapped prompt rows and the `>>>` prefix.
Changed:

- Updated `src/tui.ts`:
  - changed `buildPromptRenderLines(...)` so every prompt interior row is rendered with `colorText(..., INPUT_PINK)`
  - this applies `#ffccff` to row 1 (`>>>` + typed text) and multiline continuation rows while keeping prompt borders unchanged
- Updated `tests/tui-resize-render.test.ts`:
  - added explicit ANSI assertion for prompt row color (`38;2;255;204;255`)
  - added wrapped-row assertion that each prompt content row contains the pink ANSI sequence
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (120 passing)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Run `npm run dev` to visually confirm prompt typing and wrapped lines are consistently `#ffccff` across your terminal profile.

## 2026-02-23 22:32 UTC — Exchange 30

Summary: Fixed multiline user output coloring so continuation lines in chat history remain `#ffccff` pink.
Changed:

- Updated `src/messages.ts`:
  - changed `formatUserMessage(...)` to color each output line individually
  - first line remains prefixed as `>>> ...`, continuation lines are also wrapped with `INPUT_PINK` ANSI color
  - resolves split-line rendering case where only the first line had an ANSI color prefix
- Updated `tests/messages.test.ts`:
  - added multiline regression test asserting continuation line starts with pink ANSI sequence
  - verifies stripped plain text remains `>>> first line\\nsecond line`
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (121 passing)
- `npm run lint` — clean
- `npm run format:check` — clean
  Next:
- Run `npm run dev` and submit a multiline prompt to confirm history rendering stays pink on every user-output line.

## 2026-02-23 22:38 UTC — Exchange 31

Summary: Matched prompt-box border status text color with the title-box model/provider token light blue.
Changed:

- Updated `src/tui.ts`:
  - imported `GRADIENT_BLUE` and added `clipPromptStatusText(...)` to mirror prompt status clipping logic
  - changed `buildPromptRenderLines(...)` bottom-row rendering to keep border/corners styled while rendering the right-aligned status segment in `GRADIENT_BLUE`
- Updated `tests/tui-resize-render.test.ts`:
  - added regression assertion that the prompt bottom row includes blue ANSI (`38;2;137;207;240`) for model/provider status text
    Validation:
- `npm run typecheck` — clean
- `npm test` — clean (121 passing)
  Next:
- Run `npm run dev` and confirm visually that the prompt border status text now matches the title-box light blue token color in your terminal theme.

## 2026-02-23 22:41 UTC — Exchange 32

Summary: Updated the title box label from "Yips CLI" to "Yips".
Changed:

- Updated `src/title-box.ts`:
  - changed top border title constant from `Yips CLI` to `Yips`
- Updated `tests/title-box.test.ts`:
  - adjusted expectations to match the new title text in full, single, and minimal layouts
    Validation:
- `npm test -- tests/title-box.test.ts` — clean (11 passing)
  Next:
- Run `npm run dev` for a quick visual check that the top border now renders `Yips` at runtime.

## 2026-02-23 22:44 UTC — Exchange 33

Summary: Aligned right-column title-box gradients to the full box borders so tips and the section divider no longer restart from local column pink.
Changed:

- Updated `src/title-box.ts`:
  - added `styleLeftTextGlobalGradient(...)` to color right-column text using global column positions against the full title-box width
  - wired right-column "Tips for getting started" rows and the divider row to global-gradient styling in full layout
- Updated `tests/title-box.test.ts`:
  - added regression coverage that validates ANSI gradient start color for the tips row and divider row matches the expected outer-border-relative position
    Validation:
- `npm test -- tests/title-box.test.ts` — clean (12 passing)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` and visually confirm the right-panel gradient now sits in the expected yellow-shifted range relative to the title-box borders.

## 2026-02-23 22:49 UTC — Exchange 34

Summary: Anchored title-box greeting and cwd gradients to each string span so colors begin/end on the first/last visible character.
Changed:

- Updated `src/title-box.ts`:
  - added `styleCenteredTextWithGradientSpan(...)` to center text while applying gradient only across the actual string, leaving side padding uncolored
  - switched full/single layout welcome rows and cwd rows to use the new helper
- Updated `tests/title-box.test.ts`:
  - added regression coverage validating ANSI start/end colors for both "Welcome back {user}!" and `{cwd}` in single layout
    Validation:
- `npm test` — clean (123 passing)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` for a quick visual check that centered greeting/cwd gradients now start and end exactly on the text bounds.

## 2026-02-23 15:51 UTC — Exchange 35

Summary: Changed the full-layout title-box "Recent activity" label color to white.
Changed:

- Updated `src/title-box.ts`:
  - added `white` style support in `styleLeftText(...)` using ANSI `rgb(255,255,255)`
  - switched full-layout right-column "Recent activity" row from blue to white
- Updated `tests/title-box.test.ts`:
  - added regression test asserting the "Recent activity" text starts with white ANSI foreground color
    Validation:
- `npm test -- tests/title-box.test.ts` — clean (14 passing)
  Next:
- Run `npm run dev` and visually confirm the full-layout "Recent activity" row appears white in your terminal theme.

## 2026-02-23 22:56 UTC — Exchange 36

Summary: Hid model and token usage in title/prompt status when no real model is loaded, showing provider-only until a model is available.
Changed:

- Updated `src/tui.ts`:
  - added `resolveLoadedModel(...)` to treat unresolved model values as missing (`""` and `"default"`)
  - `buildTitleBoxOptions(...)` now omits model/token usage when no loaded model is available
  - added `buildPromptStatusText(...)` so prompt border status renders provider-only until a loaded model exists (busy label still appended when active)
- Updated `src/title-box.ts`:
  - `buildModelInfo(...)` now composes provider/model/token from available fields and returns provider-only when model is missing
- Updated `tests/title-box.test.ts`:
  - added regression test verifying model/token text stays hidden when model is missing
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/title-box.test.ts tests/tui-resize-render.test.ts` — clean
  Next:
- Run `npm run dev` for an interactive visual pass to confirm provider-only status appears before model load and model/token appear once a model is set.

## 2026-02-23 23:01 UTC — Exchange 37

Summary: Ignored local workspace config directories to prevent accidental commits.
Changed:

- Updated `.gitignore`:
  - added `.claude/`
  - added `.obsidian/`
    Validation:
- Manual check: `git status --short` now no longer lists files under `.claude/` or `.obsidian/`.
  Next:
- Optionally commit `.gitignore` if you want this guardrail persisted for the team.

## 2026-02-23 23:03 UTC — Exchange 38

Summary: Removed default "session" title-box footer label before a session name exists.
Changed:

- Updated `src/tui.ts`:
  - changed runtime default `sessionName` from `"session"` to an empty string
- Updated `src/title-box.ts`:
  - `makeBottomBorder(...)` now renders a plain gradient border when `sessionName` is empty/whitespace
  - session label insertion remains unchanged when a non-empty session name is present
- Updated `tests/title-box.test.ts`:
  - added regression test ensuring bottom border does not include a session label when `sessionName` is unset
    Validation:
- `npm test -- tests/title-box.test.ts` — clean (16 passing)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` and visually confirm the bottom border shows no `session` text before a session name is set.

## 2026-02-23 23:07 UTC — Exchange 39

Summary: Made the welcome and getting-started heading strings render in bold in the title box.
Changed:

- Updated `src/title-box.ts`:
  - added `withBold(...)` helper to wrap rendered rows with ANSI bold on/off codes
  - applied bold styling to `Welcome back {user}!` in single and full layouts
  - applied bold styling to `Tips for getting started:` in full layout
- Updated `tests/title-box.test.ts`:
  - added regression test verifying bold state is active at the start column of both target strings
  - added `isBoldBeforeColumn(...)` ANSI-state helper for robust bold assertions
    Validation:
- `npm test` — clean (13 files, 127 tests)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` for a quick visual confirmation of bold emphasis in your terminal theme.

## 2026-02-23 23:16 UTC — Exchange 40

Summary: Changed the title-box YIPS logo to use a continuous row-major gradient from the top-left Y through the bottom-right S.
Changed:

- Updated `src/colors.ts`:
  - added `rowMajorGradient(...)` utility that advances gradient progress left-to-right across each row, then continues on the next row
  - retained existing `diagonalGradient(...)` behavior for compatibility
- Updated `src/title-box.ts`:
  - switched logo rendering in single/compact/minimal/full layouts from `diagonalGradient(...)` to `rowMajorGradient(...)`
- Updated `tests/colors.test.ts`:
  - added `rowMajorGradient` coverage for empty input, uneven line lengths, endpoint anchoring, and row-to-row continuity
  - updated ANSI color-state helper to avoid regex control-character lint issues
- Updated `tests/title-box.test.ts`:
  - added regression test asserting logo top-left and bottom-right glyph cells map to pink/yellow endpoints in full layout
  - updated ANSI color-state helper to avoid regex control-character lint issues
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (13 files, 132 tests)
  Next:
- Run `npm run dev` and visually verify the logo gradient now sweeps continuously row-by-row from the top-left Y to the bottom-right S.

## 2026-02-24 17:26 UTC — Exchange 41

Summary: Restored the Yips model downloader in the TypeScript project by porting Hugging Face GGUF list/files/download flows and wiring `/download` + `/dl`.
Changed:

- Added `src/model-downloader.ts`:
  - `listGgufModels(...)` for Hugging Face GGUF discovery
  - `listModelFiles(...)` for GGUF file enumeration per repo
  - `downloadModelFile(...)` for streaming downloads to local models directory
  - renderer helpers for model/file output text
  - default models directory resolution (`YIPS_MODELS_DIR` override, else `~/.yips/models`)
- Updated `src/commands.ts`:
  - command dispatch now supports async handlers
  - implemented `/download` and `/dl` handlers with:
    - top models view (`/download`)
    - search (`/download search <query>`)
    - repo file listing (`/download files <repo_id>`)
    - direct download (`/download <repo_id> <file_path.gguf>`)
- Updated `src/tui.ts`:
  - command execution path now awaits async command dispatch
- Added tests in `tests/model-downloader.test.ts`:
  - model listing, file listing, download write path, output rendering
- Updated `tests/commands.test.ts`:
  - adapted for async dispatch
  - added `/download` and `/dl` regression coverage
- Updated docs:
  - `docs/guides/slash-commands.md` downloader usage section
  - `docs/changelog.md` Unreleased entries for downloader restoration
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (15 files, 156 tests)
  Next:
- Add an interactive downloader UI layer in Ink (model list + file picker) on top of the restored backend downloader functions.
- Add optional download progress reporting in TUI output for long GGUF transfers.

## 2026-02-24 17:27 UTC — Exchange 42

Summary: Removed LM Studio integration references completely from the TypeScript project.
Changed:

- Updated `src/model-downloader.ts`:
  - default models directory now resolves to `~/.yips/models` (or `YIPS_MODELS_DIR` override)
  - removed `.lmstudio` default path coupling
- Updated docs to remove LM Studio references:
  - `docs/roadmap.md` decision log alternatives
  - `docs/stack.md` yips-cli comparison backend row
  - `docs/changelog.md` legacy LM Studio wording adjusted to backend-generic wording
  - `docs/progress-log.md` prior entry corrected from `~/.lmstudio/models` to `~/.yips/models`
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (15 files, 156 tests)
  Next:
- If desired, add a one-time migration note/command to move existing models from `~/.lmstudio/models` to `~/.yips/models`.

## 2026-02-24 17:45 UTC — Exchange 43

Summary: Implemented full modal-style Yips Model Downloader restoration in the Ink TUI, with modal-first `/download` behavior and direct Hugging Face URL downloads.
Changed:

- Added `src/hardware.ts`:
  - RAM/VRAM detection (NVIDIA `nvidia-smi`, AMD sysfs fallback)
  - cached combined memory specs (`ramGb`, `vramGb`, `totalMemoryGb`)
- Expanded `src/model-downloader.ts`:
  - added direct URL parsing/validation (`parseHfDownloadUrl`, `isHfDownloadUrl`)
  - added quantization extraction for file rows
  - added suitability metadata (`canRun`, `reason`) for models/files
  - added RAM+VRAM filtering of oversized entries
  - download now accepts explicit revision from URL path
- Added `src/downloader-state.ts`:
  - downloader tab/view state, selection/scroll helpers, loading/error helpers
- Added `src/downloader-ui.ts`:
  - full-screen modal renderer with gradient frame/title, tabs, search row, model list, file list, and footer key hints
- Updated `src/commands.ts`:
  - `CommandResult` now supports `uiAction`
  - `/download` and `/dl` now open interactive modal with no args
  - `/download <hf_url>` supports direct download from `hf.co`/`huggingface.co`
  - removed old `/download search|files|<repo> <file>` command paths
- Updated `src/tui.ts`:
  - added modal mode routing (`uiMode: chat|downloader`)
  - downloader keyboard handling on raw input (search typing, tab cycling via arrows, list/file selection, esc back/close)
  - async model/file loading and in-modal download flow integrated with output confirmation
  - dedicated downloader render path that temporarily replaces chat/title/prompt layout while modal is active
- Added/updated tests:
  - `tests/model-downloader.test.ts` (URL parsing, filtering, quant metadata, download path)
  - `tests/commands.test.ts` (modal open action + direct URL behavior)
  - new `tests/downloader-state.test.ts`
  - new `tests/downloader-ui.test.ts`
- Updated docs:
  - `docs/guides/slash-commands.md` for modal-first `/download` + direct URL syntax
  - `docs/changelog.md` Unreleased entries for modal restoration and memory-based filtering
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (17 files, 165 tests)
  Next:
- Add in-modal download progress feedback (byte/percent updates) during large GGUF transfers.
- Add an integration test that exercises TUI mode-switch `/download` -> modal render -> escape back to chat.

## 2026-02-24 17:52 UTC — Exchange 44

Summary: Continued downloader restoration with closer yips-cli behavior parity for ranking, compatibility heuristics, and file selection safety.
Changed:

- Updated `src/downloader-state.ts`:
  - `Top Rated` now maps to Hugging Face `trendingScore` (matching legacy downloader semantics).
- Updated `src/model-downloader.ts`:
  - RAM/VRAM suitability now uses the same 1.2x memory heuristic as yips-cli (`TOTAL_MEM_GB * 1.2`).
  - file list flow now keeps oversized GGUF files visible with `canRun=false` + reason instead of dropping them.
- Updated `src/tui.ts`:
  - downloader modal now blocks `Enter` downloads for incompatible file selections and shows an in-modal error.
- Updated `src/downloader-ui.ts`:
  - empty file message now reflects full GGUF list behavior (`No GGUF files found`) instead of compatibility-only wording.
- Updated tests:
  - `tests/downloader-state.test.ts` now asserts `Top Rated -> trendingScore`.
  - `tests/model-downloader.test.ts` now verifies oversized files are present but flagged incompatible.
    Validation:
- `npm test -- tests/downloader-state.test.ts tests/model-downloader.test.ts tests/downloader-ui.test.ts` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 165 tests)
  Next:
- Add in-modal visual styling for incompatible file rows (for example a warning glyph/color) to make blocked selections obvious before pressing Enter.

## 2026-02-24 18:20 UTC — Exchange 45

Summary: Implemented downloader UX/behavior fixes from the bug list: inline rendering, prompt-box search, HF 400 recovery, border/style parity, and Esc handling.
Changed:

- Updated `src/tui.ts`:
  - downloader no longer replaces the whole screen; it renders inline in the output stack while title/chat/prompt remain visible
  - prompt composer is now the downloader search input source in downloader mode
  - added debounced search sync from prompt composer to downloader state/API calls
  - entering downloader seeds composer text from existing downloader search query
  - Esc in model-list view now reliably closes downloader back to chat mode
  - downloader prompt status now shows `model-downloader · search`
- Updated `src/model-downloader.ts`:
  - fixed model-list request shape by sending repeated HF `expand` params instead of a CSV value
  - added automatic fallback retry without `expand` params on HTTP 400/422 responses
- Updated `src/input-engine.ts`:
  - added lone-ESC handling to emit `cancel` (so Esc works consistently in downloader mode)
- Updated `src/hardware.ts` and `src/downloader-state.ts`:
  - restored downloader telemetry with disk-free tracking (`diskFreeGb`) alongside RAM/VRAM totals
- Updated `src/downloader-ui.ts`:
  - fixed border alignment issues by using ANSI-aware visible-width calculations
  - restored active tab highlight styling (pink→yellow gradient) with dim inactive tabs
  - removed in-panel search row to defer search input to the shared prompt box
  - updated footer copy from `Esc Quit` to `Esc Close` in model-list view
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 167 tests)
  Next:
- Add downloader-specific integration tests that assert prompt input updates search results while the inline panel remains visible with chat history.

## 2026-02-24 18:34 UTC — Exchange 46

Summary: Restored yips-cli-style highlighted gradients and list styling in downloader, and added background tab preloading with in-memory tab cache for instant switching.
Changed:

- Updated `src/colors.ts`:
  - added background-color helpers (`bgColorText`, `horizontalGradientBackground`) for gradient-highlight UI parity
- Updated `src/downloader-ui.ts`:
  - active tabs now use highlighted gradient backgrounds (not only foreground gradients)
  - selected model/file rows now use yips-cli-like gradient-highlighted backgrounds with focus accent
  - non-selected file rows now use semantic status coloring (green for compatible, red for incompatible)
  - fixed row width math so styled rows remain aligned and avoid style-stripping overflow fallback
- Updated `src/downloader-state.ts`:
  - added downloader tab cache state (`cacheQuery`, `modelCacheByTab`, `preloadingTabs`)
  - added cache helper utilities (`setCachedModels`, `getCachedModels`, `resetModelCache`, `setPreloadingTabs`)
  - exported `DOWNLOADER_TABS` constant for shared tab iteration
- Updated `src/tui.ts`:
  - tab switches now hydrate instantly from cache when available
  - search refresh now clears/rebuilds per-query tab cache and preloads non-active tabs in background
  - opening downloader now triggers active-tab fetch + background preload for other tabs
- Updated tests:
  - `tests/downloader-state.test.ts` expanded for tab constant and cache lifecycle coverage
  - `tests/downloader-ui.test.ts` expanded to verify highlighted/background styling and file status coloring paths
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 170 tests)
  Next:
- Add a focused integration test with mocked downloader fetches to assert tab-switch cache hits avoid network calls after preload.

## 2026-02-24 02:03 UTC — Exchange 11

Summary: Fixed downloader frame instability during loading/downloading and added live model download progress/status rendering.
Changed:

- Extended downloader state machine in `src/downloader-state.ts`:
  - added explicit phases (`idle`, `loading-models`, `loading-files`, `downloading`, `error`)
  - added structured download progress state (`bytesDownloaded`, `totalBytes`, timestamps, status text)
  - added transition helpers: `setLoadingModels`, `setLoadingFiles`, `startDownload`, `updateDownloadProgress`, `finishDownload`, `setDownloaderError`
- Enhanced downloader API in `src/model-downloader.ts`:
  - added optional `onProgress` callback to `DownloadModelFileOptions`
  - emits streaming progress updates while reading chunks
  - reads `content-length` when available and reports unknown total when absent
- Reworked downloader renderer in `src/downloader-ui.ts`:
  - stabilized panel height with fixed body row counts for both model and file views
  - ensured bordered blank fill rows in loading/error/downloading states
  - added dedicated downloading body with activity line, progress bar, and status text
- Updated TUI wiring in `src/tui.ts`:
  - replaced generic loading/error updates with phase-specific downloader transitions
  - integrated `downloadModelFile(..., onProgress)` callback into runtime state updates
  - added byte/speed/ETA status formatting helpers
  - after successful download, return to the file list view in idle phase
- Added and expanded tests:
  - `tests/downloader-state.test.ts`: phase transitions, error transition, and progress updates
  - `tests/downloader-ui.test.ts`: fixed frame height across states, bordered loading rows, downloading progress/status render
  - `tests/model-downloader.test.ts`: progress callback behavior with and without `content-length`
    Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-state.test.ts tests/downloader-ui.test.ts tests/model-downloader.test.ts` — clean
- `npm test` — 177 passing
- `npm run lint` — clean
  Next:
- Add a focused TUI integration-style render test that verifies downloader progress updates do not shift prompt-box geometry during rapid onProgress re-renders.

## 2026-02-24 02:07 UTC — Exchange 12
Summary: Fixed remaining downloader border break during loading by removing wide glyph usage in loading/download lines.
Changed:
- Updated `src/downloader-ui.ts` loading/downloading copy to avoid the wide `⏳` glyph, which could exceed terminal cell calculations and push right borders.
  - `⏳ ...` -> `Loading: ...`
  - `⏳ Downloading ...` -> `Downloading ...`
- Kept fixed-row body rendering logic unchanged; only width-safe text rendering changed.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts` — clean
Next:
- If border artifacts persist in specific terminals/fonts, add display-width-aware string measurement (wcwidth-based) instead of codepoint counting in `src/downloader-ui.ts`.

## 2026-02-24 02:09 UTC — Exchange 13
Summary: Reduced download-screen flicker and hardened download-view border stability.
Changed:
- Updated `src/tui.ts` download progress rendering path:
  - throttled `forceRender()` during `onProgress` updates using time and byte gates
  - added constants:
    - `DOWNLOADER_PROGRESS_RENDER_INTERVAL_MS = 80`
    - `DOWNLOADER_PROGRESS_RENDER_STEP_BYTES = 512 * 1024`
  - preserved immediate render at start and completion
- Updated `src/downloader-ui.ts` progress bar glyphs to ASCII width-safe characters:
  - `[████░░░░]` style replaced with `[====----]`
- Updated `src/tui.ts` download status text separators to ASCII (`|`) to avoid terminal-width ambiguity in downloader rows.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts` — clean
Next:
- If flicker persists on very high-throughput links, add a dedicated sampled progress state timer (e.g., 10 FPS) so render cadence is fully decoupled from network chunk cadence.

## 2026-02-24 02:12 UTC — Exchange 14
Summary: Reworked downloader progress rendering to fixed-rate repainting to address persistent flicker; restored original block-style progress bar.
Changed:
- Updated `src/tui.ts` download progress path:
  - removed chunk-cadence `forceRender()` calls from `onProgress`
  - added `downloaderProgressDirtyRef` to mark pending UI updates
  - added fixed-interval progress repaint loop (`100ms`) that renders only when:
    - a progress update is pending
    - UI is in downloader mode
    - downloader phase is `downloading`
  - reset dirty flags on start/finish/error transitions
- Updated `src/downloader-ui.ts`:
  - restored block-style progress bar glyphs (`█` and `░`) per user preference
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts` — clean
Next:
- If any terminal still flickers, add optional low-refresh mode (e.g., 5 FPS) toggled by env var for slower redraw cadence.

## 2026-02-24 02:22 UTC — Exchange 15
Summary: Implemented download-screen UX corrections: clear previous list chrome while downloading, full-width progress bar, and real Esc cancel behavior.
Changed:
- Updated `src/downloader-ui.ts` downloading layout:
  - hides tabs/memory header row while `phase === downloading` (renders a cleared row instead)
  - footer now shows `[Esc] Cancel` during active download
  - progress bar width now fills available inner row width (no 40-char cap)
- Updated `src/model-downloader.ts`:
  - added `signal?: AbortSignal` to `DownloadModelFileOptions`
  - passes `signal` to `fetch` for cancellation
- Updated `src/tui.ts` cancellation flow:
  - added `AbortController` ref for active downloader transfer
  - `Esc` in downloader while downloading now aborts transfer, clears downloading phase, and logs `Download canceled.` to output
  - abort errors are treated as cancellation (not surfaced as downloader error)
  - teardown now aborts any active download controller
- Updated tests in `tests/downloader-ui.test.ts`:
  - verifies downloading view hides tabs row text
  - verifies downloading footer is `[Esc] Cancel`
  - verifies progress line consumes row width up to the right border
Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-ui.test.ts tests/model-downloader.test.ts tests/downloader-state.test.ts` — clean
- `npm run lint -- src/tui.ts src/downloader-ui.ts src/model-downloader.ts tests/downloader-ui.test.ts` — clean
Next:
- If any terminal still shows visual flicker, add a dedicated optional low-FPS download repaint mode (`YIPS_DOWNLOADER_FPS`) for user-tunable cadence.

## 2026-02-24 02:26 UTC — Exchange 16
Summary: Reduced downloader panel height specifically for active download mode.
Changed:
- Updated `src/downloader-ui.ts`:
  - added `DOWNLOADER_DOWNLOADING_BODY_ROWS = 7`
  - download-phase renderer now uses the compact body row count while keeping model/file browsing heights unchanged
- Updated `tests/downloader-ui.test.ts`:
  - adjusted download-mode frame height expectation from 14 lines to 11 lines
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts tests/downloader-ui.test.ts` — clean
Next:
- If desired, make compact height configurable by terminal size (e.g., adaptive body rows based on `rows`), instead of a fixed constant.

## 2026-02-24 02:32 UTC — Exchange 17
Summary: Made downloading view fully compact with no empty body lines and moved status text to the bottom-right footer.
Changed:
- Updated `src/downloader-ui.ts` downloading-mode rendering:
  - removed the tabs/header row while downloading
  - reduced downloading body to only 2 rows: `Downloading ...` and full-width progress bar
  - removed padded blank rows in downloading mode
  - footer in downloading mode now renders split content:
    - left: `[Esc] Cancel`
    - right: live `statusText` (download bytes/speed/ETA), right-aligned inside the box
- Added `lineWithSplitFooter(...)` helper for left/right aligned footer text within bordered row width constraints.
- Updated `tests/downloader-ui.test.ts` expectations:
  - downloading panel height now `5` lines total
  - asserts no blank bordered lines in downloading mode
  - keeps assertions for hidden tabs and cancel footer
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts tests/downloader-ui.test.ts` — clean
Next:
- If desired, apply the same split-footer pattern to non-downloading file view for richer right-side context in a single row.

## 2026-02-24 02:35 UTC — Exchange 18
Summary: Reduced residual download flashing by decoupling network chunk callbacks from immediate downloader state mutation/render.
Changed:
- Updated `src/tui.ts` download update pipeline:
  - increased download repaint interval to 200ms
  - added `downloaderProgressBufferRef` to buffer the latest `(bytesDownloaded, totalBytes)` from `onProgress`
  - `onProgress` now only writes to buffer + marks dirty (no direct state mutation)
  - timer loop now applies buffered progress to state (`updateDownloadProgress`) and re-renders once per tick
  - clears buffered progress on cancel/finish/error/unmount
- Existing compact download layout and bottom-right status placement remain unchanged.
Validation:
- `npm run typecheck` — clean
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts tests/model-downloader.test.ts` — clean
- `npm run lint -- src/tui.ts` — clean
Next:
- If flashing persists in a specific terminal emulator, add a terminal capability fallback mode that temporarily disables truecolor gradients while downloading.

## 2026-02-24 03:12 UTC — Exchange 19
Summary: Restored `/models` Yips Model Manager from yips-cli into the TypeScript Ink TUI with local model list/switch/delete, downloader handoff, nickname persistence, and command wiring parity.
Changed:
- Added model manager implementation modules:
  - `src/model-manager.ts`: recursive local GGUF discovery from `YIPS_MODELS_DIR` or `~/.yips/models`, model metadata shaping, local matching helpers, filtering helpers, and safe local model delete with empty-directory pruning.
  - `src/model-manager-state.ts`: model-manager UI state machine (loading/error/idle, selection/scroll, search filtering, remove/select helpers).
  - `src/model-manager-ui.ts`: bordered gradient Model Manager renderer with yips-cli-style column layout, selected-row highlights, current-model marker, RAM/VRAM header, and action footer.
- Extended runtime/config types and persistence:
  - `src/types.ts`: added `nicknames` to `AppConfig`.
  - `src/config.ts`: added nickname normalization plus `saveConfig()` and `updateConfig()` persistence helpers.
- Updated slash-command behavior in `src/commands.ts`:
  - `/model` without args now opens Model Manager UI mode.
  - `/model <name>` now attempts local exact/partial model matching first, then falls back to free-form assignment.
  - `/models` now implemented as UI-open command (UI-only alias).
  - `/nick <target> <nickname>` now implemented and persisted to `.yips_config.json`.
- Integrated model-manager mode in `src/tui.ts`:
  - added `uiMode: chat|downloader|model-manager` and `modelManager` runtime state.
  - wired `/model` and `/models` `uiAction` handling to open manager mode.
  - manager mode uses Prompt Composer text as live local search.
  - keyboard behavior in manager mode: select (`Enter`), close (`Esc`), move (`↑/↓`), delete local model (`Del`), and downloader handoff via `t` when search is empty.
  - selected model switch now persists config and logs in output.
- Added/updated tests:
  - new `tests/model-manager.test.ts`.
  - new `tests/model-manager-state.test.ts`.
  - new `tests/model-manager-ui.test.ts`.
  - updated `tests/commands.test.ts` for `/model` UI-open behavior, `/models`, local matching, and `/nick` persistence.
  - updated `tests/config.test.ts` for `nicknames` plus persistence helper coverage.
- Updated docs:
  - `docs/guides/slash-commands.md` command table for `/model`, `/models`, and `/nick` behavior.
  - `docs/roadmap.md` marked Model Manager and configuration file support as completed.
  - `docs/changelog.md` updated with restored Model Manager and command/persistence changes.
Validation:
- `npm run typecheck` — clean
- `npm test` — clean (20 files, 192 tests)
- `npm run lint` — clean
- `npm run format:check` — still reports pre-existing formatting drift in unrelated files (unchanged by this exchange)
Next:
- Add focused TUI integration coverage for model-manager mode transitions (`/model` open, in-mode search/select/delete, Esc close, and manager -> downloader handoff).
- Revisit manager-mode `t` key handling if strict single-key semantics are needed independently of typed search input.

## 2026-02-24 03:57 UTC — Exchange 20
Summary: Implemented llama.cpp server lifecycle management with boot/request readiness checks, auto-start diagnostics, and config schema expansion; included and committed prior in-progress workspace changes.
Changed:
- Added `src/llama-server.ts` with managed lifecycle helpers:
  - health probe (`/health`) checks
  - binary resolution (`LLAMA_SERVER_PATH`, config path, `which llama-server`, fallback path)
  - model resolution (absolute path, models-dir relative, recursive `.gguf` partial match)
  - server start with configurable host/port/context/gpu-layers
  - managed stop/cleanup for processes started by Yips
  - typed failure reasons and `formatLlamaStartupFailure(...)` for actionable UX
- Expanded runtime config schema:
  - `src/types.ts` adds `llamaServerPath`, `llamaModelsDir`, `llamaHost`, `llamaPort`, `llamaContextSize`, `llamaGpuLayers`, `llamaAutoStart`.
  - `src/config.ts` now defaults/normalizes those fields, keeps backward compatibility, and supports env overrides (`YIPS_LLAMA_*`, `YIPS_LLAMA_AUTO_START`).
- Integrated lifecycle checks in `src/tui.ts`:
  - boot preflight readiness check for `llamacpp`
  - per-request readiness check before chat/stream path
  - startup failure output now includes actionable diagnostics and exact checks
  - unmount cleanup now calls managed llama-server stop
- Added new lifecycle tests in `tests/llama-server.test.ts` for:
  - healthy endpoint readiness
  - auto-start-disabled failure behavior
  - binary-not-found classification
  - model-not-found classification
  - process-exited classification
  - diagnostic formatter content
- Updated `tests/config.test.ts` for expanded config fields and env override coverage.
- Included existing workspace changes requested for commit (`docs/stack.md`, `src/colors.ts`, `src/input-engine.ts`, `tests/input-engine.test.ts`, `src/hardware.ts`, `.yips_config.json`).
Validation:
- `npm run typecheck` — clean
- `npm test` — clean (21 files, 199 tests)
- `npm run lint` — clean
Next:
- Add `/backend` implementation and optional Claude fallback path so users can recover from llama.cpp failures without leaving chat mode.
- Add focused TUI integration tests for startup preflight message rendering and managed shutdown behavior.

## 2026-02-24 04:13 UTC — Exchange 21
Summary: Added an automated `install.sh` for one-command local runtime setup (dependencies, llama.cpp build, env wiring, config normalization) with model-downloader guidance when no GGUF exists.
Changed:
- Added executable `install.sh` at repository root.
- Installer behavior:
  - detects OS/package manager (`apt`, `dnf`, `brew`) and auto-installs missing prerequisites (`git`, `cmake`, build tools, `node`, `npm`, `curl`)
  - clones or fast-forward updates `~/llama.cpp`
  - builds llama.cpp with CUDA-first attempt (when `nvidia-smi` available) and CPU fallback
  - validates `~/llama.cpp/build/bin/llama-server`
  - creates `~/.yips/models`
  - writes idempotent `~/.yips/env.sh` exports (`LLAMA_SERVER_PATH`, `YIPS_LLAMA_SERVER_PATH`, `YIPS_LLAMA_MODELS_DIR`)
  - runs `npm install` in repo root
  - creates or patches `.yips_config.json` to ensure lifecycle fields exist without overwriting existing user values
  - prints final next-step instructions and prompts users to use `/download` or `/model` if no local GGUF model exists
- Updated docs:
  - `docs/guides/getting-started.md` now includes automated install flow and `source ~/.yips/env.sh` step.
  - `docs/changelog.md` updated with installer entry.
Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean
Next:
- Add a focused installer smoke-check in CI (shell syntax + dry-run validation) once a non-destructive dry-run mode is introduced.

## 2026-02-24 04:20 UTC — Exchange 22
Summary: Added Arch Linux `pacman` support to `install.sh` and updated setup docs accordingly.
Changed:
- Updated `install.sh` package manager detection to include `pacman`.
- Added `install_packages_pacman()` helper using `pacman -Sy --needed --noconfirm`.
- Added Arch dependency mapping in prerequisite install flow:
  - `git cmake base-devel curl nodejs npm`
- Updated `docs/guides/getting-started.md` to list `pacman` among supported package managers for automated install.
Validation:
- Script logic review for package-manager dispatch path (`apt`/`pacman`/`dnf`/`brew`) completed.
Next:
- Optionally add a non-destructive `--dry-run` mode to `install.sh` and validate pacman branch in CI without root installs.

## 2026-02-24 04:24 UTC — Exchange 23
Summary: Fixed Arch installer CUDA fallback failure by preventing stale CMake CUDA cache from poisoning CPU fallback; added nvcc gate for CUDA attempts.
Changed:
- Updated `install.sh` CPU fallback path:
  - clears `${LLAMA_BUILD_DIR}/CMakeCache.txt` and `${LLAMA_BUILD_DIR}/CMakeFiles` before reconfigure
  - explicitly configures CPU build with `-DGGML_CUDA=OFF`
- Updated CUDA decision logic:
  - if NVIDIA GPU is present but `nvcc` is missing, installer now skips CUDA attempt and goes straight to CPU build with a warning
- Verified script syntax with `bash -n install.sh`.
Validation:
- `bash -n install.sh` — clean
Next:
- Optionally add an explicit Arch CUDA prerequisite hint (e.g. `cuda` package) when `nvidia-smi` is present but `nvcc` is absent.

## 2026-02-24 04:27 UTC — Exchange 24
Summary: Added explicit opt-in CUDA install flag (`--cuda`) to installer.
Changed:
- Updated `install.sh`:
  - added argument parsing with `--cuda` and `--help`
  - added CUDA toolkit install step gated by `--cuda`
  - package mapping for CUDA toolkit install:
    - `apt`: `nvidia-cuda-toolkit`
    - `pacman`: `cuda`
    - `dnf`: `cuda`
  - default install behavior remains unchanged unless `--cuda` is passed
- Updated docs:
  - `docs/guides/getting-started.md` now documents `./install.sh --cuda`
  - `docs/changelog.md` updated with `--cuda` support note
Validation:
- `bash -n install.sh` — clean
- `./install.sh --help` output verified
Next:
- Add `--dry-run` mode to validate package actions in CI without privileged installs.

## 2026-02-24 04:35 UTC — Exchange 25
Summary: Hardened Arch installer behavior to avoid partial-upgrade breakage and auto-repair broken Node runtime linkage before npm install.
Changed:
- Updated `install.sh` pacman workflow:
  - replaced sync-only installs with full-upgrade semantics on first pacman invocation (`pacman -Syu --needed --noconfirm ...`)
  - subsequent pacman installs in same run use `pacman -S --needed --noconfirm ...`
- Added Node runtime health checks:
  - validates `node -v` and `npm -v` executability (not just command presence)
  - captures diagnostics for linker/runtime failures
- Added Arch self-heal path for broken Node linkage:
  - auto-runs `pacman -Syu --needed nodejs npm simdjson`
  - rechecks runtime health and exits with actionable manual commands if still broken
- Updated docs:
  - `docs/guides/getting-started.md` now notes Arch full-upgrade behavior and Node self-heal
  - `docs/changelog.md` includes Arch pacman/runtime hardening notes
Validation:
- `bash -n install.sh` — clean
- `./install.sh --help` — clean
- Note: npm/typecheck/test were not run in-session because current environment has broken Node shared-library linkage (the exact condition this patch is intended to recover).
Next:
- Add optional `--dry-run` mode so package actions and repair branches can be validated in CI without privileged changes.

## 2026-02-24 04:38 UTC — Exchange 26
Summary: Extended installer to add a global `yips` launcher path for running from any directory.
Changed:
- Updated `install.sh`:
  - adds `YIPS_BIN_DIR=~/.local/bin` and creates the directory during install
  - writes env exports in `~/.yips/env.sh`:
    - `YIPS_BIN_DIR`
    - `PATH="$YIPS_BIN_DIR:$PATH"`
  - installs executable launcher at `~/.local/bin/yips`
    - launcher enters repo root and runs `node dist/index.js` when present
    - otherwise falls back to `npm run dev -- "$@"`
  - summary now prints launcher path
- Updated docs:
  - `docs/guides/getting-started.md` now uses `yips` after install
  - `docs/changelog.md` notes launcher + PATH support
Validation:
- `bash -n install.sh` — clean
Next:
- Optionally add a `--global-link` mode for users who prefer `/usr/local/bin/yips` instead of `~/.local/bin/yips`.

## 2026-02-24 04:48 UTC — Exchange 27
Summary: Fixed `yips` launcher staleness by defaulting launcher execution to source mode instead of stale `dist` artifacts.
Changed:
- Updated `install.sh` launcher generation:
  - launcher now defaults to `npm run dev -- "$@"` for latest local source behavior
  - `dist/index.js` is only used when explicitly requested via `YIPS_USE_DIST=1`
  - added inline launcher comments documenting default and override behavior
- Updated docs:
  - `docs/guides/getting-started.md` notes launcher default source-mode behavior and `YIPS_USE_DIST=1` override
  - `docs/changelog.md` includes launcher-mode update note
Validation:
- `bash -n install.sh` — clean
Next:
- Regenerate user launcher by re-running `./install.sh` (or update `~/.local/bin/yips` manually) so existing local launcher picks up the new logic.

## 2026-02-24 04:59 UTC — Exchange 28
Summary: Implemented Linux-first llama.cpp port-conflict handling with configurable policy, richer startup diagnostics, and bind-error classification to fix ambiguous startup failures.
Changed:
- Extended config/types for startup conflict policy:
  - `src/types.ts`: added `LlamaPortConflictPolicy` and `AppConfig.llamaPortConflictPolicy`.
  - `src/config.ts`: added normalization/default/env override support for `llamaPortConflictPolicy` (`YIPS_LLAMA_PORT_CONFLICT_POLICY`), defaulting to `kill-user`.
- Refactored `src/llama-server.ts` lifecycle behavior:
  - added Linux `/proc` listener ownership inspection to identify PID/UID/cmd for occupied ports.
  - added policy-driven pre-start conflict handling:
    - `fail`: return `port-unavailable` with owner diagnostics.
    - `kill-llama`: only terminate conflicting owner when command matches llama-server.
    - `kill-user`: terminate conflicting owner only when owned by current user.
  - added SIGTERM→SIGKILL termination flow with re-check to ensure port is actually freed.
  - added structured failure metadata (`host`, `port`, `conflictPid`, `conflictCommand`).
  - switched spawn stderr handling to a captured ring buffer and added bind-error pattern classification so early-exit bind failures are reported as `port-unavailable`.
  - improved startup failure formatting with endpoint/conflict context.
- Expanded tests:
  - `tests/config.test.ts`: env override coverage for `YIPS_LLAMA_PORT_CONFLICT_POLICY`.
  - `tests/llama-server.test.ts`: added policy and bind-classification coverage with deterministic mocked runtime dependencies; added cleanup via `stopLlamaServer()` to avoid cross-test state leakage.
Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/llama-server.test.ts tests/config.test.ts` — clean
- `npm test` — clean (21 files, 203 tests)
- `npm run build` — clean
Next:
- Optionally surface a short UI warning line when Yips auto-terminates a conflicting process, so users can see that recovery action happened without enabling verbose logs.

## 2026-02-24 05:14 UTC — Exchange 29
Summary: Matched Yips assistant timestamp/colon color to the title-box model-provider light blue.
Changed:
- Updated `src/messages.ts`:
  - `formatAssistantMessage(...)` now colors the timestamp (`[h:mm AM/PM]`) and trailing `:` with `GRADIENT_BLUE` (same light blue used by title-box provider text), replacing `DARK_BLUE`.
- Updated `tests/messages.test.ts`:
  - added assertion that timestamp and `:` emit ANSI `38;2;137;207;240` (the `GRADIENT_BLUE` RGB) so the visual contract is locked.
Validation:
- `npm test -- tests/messages.test.ts` — clean (10 passing)
Next:
- Optionally run full suite (`npm test`, `npm run lint`, `npm run typecheck`) before next release cut.

## 2026-02-24 05:39 UTC — Exchange 30
Summary: Implemented `/sessions` end-to-end with session file persistence, interactive loading mode, and title-box recent-activity integration.
Changed:
- Added `src/session-store.ts`:
  - session slug generation from first user message
  - session file creation and markdown serialization
  - session listing/parsing from `~/.yips/memory`
  - session load parser back into `ChatMessage[]`
- Updated `src/commands.ts`:
  - added `/sessions` implementation returning `uiAction: { type: "open-sessions" }`
  - expanded `CommandResult.uiAction` union for sessions mode
- Updated `src/tui.ts`:
  - added new UI mode: `sessions`
  - added runtime session state (`sessionFilePath`, `sessionCreated`, `recentActivity`, `sessionList`, `sessionSelectionIndex`)
  - added automatic session persistence after each exchange
  - `/clear` now resets active session metadata
  - `/sessions` now opens interactive browse mode; Up/Down selects, Enter loads, Esc cancels
  - loading a session replaces in-memory history and rebuilds output rendering from loaded messages
  - title-box options now receive dynamic recent activity and selection state
- Updated `src/title-box.ts`:
  - added optional recent activity + selection inputs
  - full layout now renders dynamic recent-activity rows
  - active session-selection row is highlighted
- Added/updated tests:
  - new `tests/session-store.test.ts`
  - `tests/commands.test.ts` now covers `/sessions` UI action
  - `tests/title-box.test.ts` now covers dynamic recent activity and selection highlight rendering
- Updated `docs/changelog.md` with `/sessions` and session persistence notes.
Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/session-store.test.ts tests/commands.test.ts tests/title-box.test.ts` — clean
- `npm test` — clean (22 files, 210 tests)
Next:
- Add focused TUI integration tests for sessions-mode transitions and loaded-history replay behavior.

## 2026-02-24 10:17 UTC — Exchange 31
Summary: Committed and pushed all current local workspace changes to GitHub.
Changed:
- Staged all modified and untracked files in the repository.
- Created a single commit containing the full local working set.
- Pushed `main` to `origin/main`.
Validation:
- `git status --short --branch` checked before and after commit/push.
Next:
- Pull latest `main` on other machines/environments before continuing new changes.

## 2026-02-24 18:35 UTC — Exchange 32
Summary: Updated model friendly-name fallback so nested GGUF model variants display their parent GGUF folder name instead of long quantized filenames.
Changed:
- Updated `src/model-manager.ts`:
  - `toFriendlyNameFallback(...)` now checks nested path segments for `.gguf` files.
  - when the immediate parent directory name contains `gguf` (case-insensitive), it is used as the fallback display name.
  - otherwise existing behavior remains (filename stem without `.gguf`).
- Updated `tests/model-manager.test.ts`:
  - added regression coverage for `Qwen/Qwen3-VL-2B-Instruct-GGUF/Qwen3VL-2B-Instruct-Q4_K_M.gguf` expecting `Qwen3-VL-2B-Instruct-GGUF`.
  - added `listLocalModels(...)` coverage verifying both `name` and `friendlyName` use the GGUF parent folder for nested variants.
Validation:
- `npm test -- tests/model-manager.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
Next:
- Optionally run full suite (`npm test`, `npm run lint`) if you want broader regression validation before the next commit.

## 2026-02-24 18:38 UTC — Exchange 33
Summary: Changed GGUF naming strategy from conditional fallback to default parent-folder naming for nested model paths.
Changed:
- Updated `src/model-manager.ts`:
  - `toFriendlyNameFallback(...)` now defaults to immediate parent directory name for nested `.gguf` model IDs.
  - retained filename-stem behavior only when there is no parent directory segment.
  - preserved nickname compatibility by checking both default name key and filename-stem key (e.g., `qwen`) in `getFriendlyModelName(...)`.
- Updated `tests/model-manager.test.ts`:
  - revised naming tests to assert parent-folder default behavior.
  - added explicit coverage that `org/repo/model-q4.gguf` defaults to `repo`.
Validation:
- `npm test -- tests/model-manager.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
Next:
- Optionally run full suite (`npm test`, `npm run lint`) before commit.

## 2026-02-24 18:43 UTC — Exchange 34
Summary: Fixed title-box and prompt status to use shortened default model display names instead of raw model paths.
Changed:
- Updated `src/model-manager.ts`:
  - exported `getModelDisplayName(modelId)` and used it as the default model naming rule.
  - `getFriendlyModelName(...)` and `listLocalModels(...)` now share `getModelDisplayName(...)` for consistent naming.
- Updated `src/tui.ts`:
  - title-box model label now uses `getModelDisplayName(...)`.
  - prompt footer status model label now uses `getModelDisplayName(...)`.
  - both no longer render full raw `owner/repo/file.gguf` path when a parent directory label exists.
- Updated `tests/model-manager.test.ts`:
  - added explicit `getModelDisplayName(...)` coverage for nested Qwen GGUF path labels.
Validation:
- `npm test -- tests/model-manager.test.ts` — clean (9 passing)
- `npm run typecheck` — clean
Next:
- Optionally run full suite (`npm test`, `npm run lint`) before commit.

## 2026-02-24 19:06 UTC — Exchange 35
Summary: Title box and prompt status now use configured model nicknames when available.
Changed:
- Updated `src/tui.ts`:
  - active model label for title-box now resolves via `getFriendlyModelName(currentModel, config.nicknames)`.
  - active model label for prompt footer status now resolves via the same nickname-aware function.
  - both still fall back to default shortened display naming when no nickname exists.
- Updated `tests/model-manager.test.ts`:
  - added regression coverage asserting exact model-id nickname precedence.
Validation:
- `npm test -- tests/model-manager.test.ts` — clean (10 passing)
- `npm run typecheck` — clean
Next:
- Optionally run full suite (`npm test`, `npm run lint`) before commit.

## 2026-02-24 19:27 UTC — Exchange 36
Summary: Updated title-box typography and cwd display: bolded top `Yips version`, bolded `Recent activity`, and shortened cwd to `~/current-folder`.
Changed:
- Updated `src/title-box.ts`:
  - `makeTopBorder(...)` now bolds the `Yips <version>` title string in the top border while preserving existing gradient/blue color styling.
  - full-layout `Recent activity` heading is now bold (and remains white).
- Updated `src/tui.ts`:
  - added exported helper `formatTitleCwd(cwd)` that renders title cwd as `~/<basename>` and falls back to `~` for root/empty basename.
  - `buildTitleBoxOptions(...)` now passes `formatTitleCwd(process.cwd())` to title-box rendering.
- Updated tests:
  - `tests/title-box.test.ts` now asserts bold styling for top `Yips 0.1.0` and for `Recent activity`.
  - `tests/tui-resize-render.test.ts` now covers `formatTitleCwd(...)` output (`~/yips` and root `~`).
Validation:
- `npm test -- tests/title-box.test.ts tests/tui-resize-render.test.ts` — clean (35 passing)
- `npm run typecheck` — clean
Next:
- Run `npm run dev` for a quick visual confirmation in your terminal theme that the top-border bold weight and cwd shorthand read as intended.

## 2026-02-24 12:32 UTC — Exchange 37
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

## 2026-02-24 19:43 UTC — Exchange 38
Summary: Polished Model Downloader UI with bold header/tab typography, separate RAM/VRAM display, aligned model-detail columns, and gradient-styled model footer commands.
Changed:
- Updated `src/downloader-ui.ts`:
  - made top border title text (`Yips Model Downloader`) bold while preserving existing gradient border styling.
  - made all downloader tab labels bold (active and inactive).
  - changed hardware summary text from combined `RAM+VRAM` to separate `RAM`, `VRAM`, and `Disk` values.
  - reworked model list body rendering into fixed aligned columns with a header row:
    - `Model | DL | Likes | Size | Updated`
  - kept frame height stable by using 1 header + 9 model rows in the same 10-row body area.
  - applied pink→yellow gradient styling to the model-list footer command line (`[Enter] Select ... [Esc] Close`) only.
- Updated `src/tui.ts`:
  - adjusted downloader model selection window size from `10` to `9` rows to match the new visible model-row count below the header.
- Updated `tests/downloader-ui.test.ts`:
  - added coverage for bold title/tabs, separate RAM/VRAM rendering, column alignment consistency, and gradient footer behavior in models view.
  - added assertion that file-view footer remains non-gradient.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (6 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optionally run a full interactive visual check with `npm run dev` to confirm column readability and footer gradient appearance in your terminal theme.

## 2026-02-24 19:48 UTC — Exchange 39
Summary: Adjusted downloader model metric glyph placement so DL and Likes icons trail values while keeping aligned columns.
Changed:
- Updated `src/downloader-ui.ts`:
  - changed DL cell formatting from `↓value` to `value↓`.
  - changed Likes cell formatting from `♥value` to `value♥`.
- Updated `tests/downloader-ui.test.ts`:
  - revised aligned-row assertions to expect `12.3k↓` and `540♥`.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (6 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual check in `npm run dev` to confirm terminal font renders trailing glyph alignment as expected.

## 2026-02-24 19:55 UTC — Exchange 40
Summary: Fixed segmented-border gradient restarts so downloader top border and prompt bottom border now render as continuous left-to-right gradients.
Changed:
- Updated `src/colors.ts`:
  - added `horizontalGradientAtOffset(...)` helper to render gradients using absolute column offsets for segmented strings.
- Updated `src/downloader-ui.ts`:
  - rewired `makeBorderTop(...)` to color prefix/title/tail/fill/right-corner with absolute-offset gradient coloring.
  - preserved bold title styling while removing gradient restart around title segment.
- Updated `src/tui.ts`:
  - rewired prompt bottom border rendering in `buildPromptRenderLines(...)`:
    - left corner, fill, and right corner now use absolute-offset gradient coloring.
    - status text remains blue, but border gradient no longer restarts at fill.
- Updated tests:
  - `tests/downloader-ui.test.ts` added top-border continuity assertion ensuring title segment does not reset to start-pink.
  - `tests/tui-resize-render.test.ts` added bottom-border continuity assertion ensuring fill column does not reset to start-pink.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/tui-resize-render.test.ts` — clean (23 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual check via `npm run dev` in your terminal to confirm continuity looks correct under your font/ANSI renderer.

## 2026-02-24 19:57 UTC — Exchange 41
Summary: Restored standalone title gradient for downloader header text while keeping continuous border gradient behavior outside the title segment.
Changed:
- Updated `src/downloader-ui.ts`:
  - `makeBorderTop(...)` now renders `Yips Model Downloader` with its own local pink→yellow gradient again.
  - retained offset-based border gradient coloring for prefix/tail/fill/right-corner so non-title border segments do not restart.
- Updated `tests/downloader-ui.test.ts`:
  - revised top-border gradient assertion to require title-start pink (standalone title gradient) and non-pink continuation after the title segment.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/tui-resize-render.test.ts` — clean (23 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual pass in `npm run dev` to confirm this exactly matches your intended title-vs-border gradient behavior.

## 2026-02-24 19:59 UTC — Exchange 42
Summary: Updated downloader and model-manager title styling so `Yips` stays pink/yellow gradient and the feature label is light blue, matching title-box style intent.
Changed:
- Updated `src/downloader-ui.ts`:
  - `makeBorderTop(...)` now renders title in two parts:
    - `Yips` with pink→yellow gradient
    - ` Model Downloader` in `GRADIENT_BLUE`
  - kept bold title styling and existing offset-based border gradient for non-title segments.
- Updated `src/model-manager-ui.ts`:
  - `makeBorderTop(...)` now renders:
    - `Yips` with pink→yellow gradient
    - ` Model Manager ` in `GRADIENT_BLUE`
- Updated tests:
  - `tests/downloader-ui.test.ts` now asserts downloader top line includes light-blue title segment coloring.
  - `tests/model-manager-ui.test.ts` now asserts model-manager top line includes light-blue title segment coloring.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/model-manager-ui.test.ts tests/tui-resize-render.test.ts` — clean (26 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual check in `npm run dev` to confirm the title split looks exactly as intended in your terminal font/theme.

## 2026-02-24 20:02 UTC — Exchange 43
Summary: Changed the Model Downloader model-table header row to a pink/yellow gradient style.
Changed:
- Updated `src/downloader-ui.ts`:
  - model-list header row (`Model | DL | Likes | Size | Updated`) now uses `horizontalGradient(..., GRADIENT_PINK, GRADIENT_YELLOW)` instead of solid blue.
- Updated `tests/downloader-ui.test.ts`:
  - added assertion that the model-list header row emits multiple truecolor foreground runs, confirming gradient styling.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual check with `npm run dev` to confirm header contrast/readability in your terminal theme.

## 2026-02-24 20:03 UTC — Exchange 44
Summary: Renamed downloader model-table `DL` header to `Downloads` while keeping column alignment intact.
Changed:
- Updated `src/downloader-ui.ts`:
  - changed model-list header label from `DL` to `Downloads`.
  - increased downloads column width from `8` to `10` so the longer header text does not break alignment.
- Updated `tests/downloader-ui.test.ts`:
  - header detection assertions now look for `Downloads` instead of `DL`.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual pass in `npm run dev` to verify column spacing looks ideal at your normal terminal width.

## 2026-02-24 20:05 UTC — Exchange 45
Summary: Tightened downloader `Downloads` column width by one character to remove extra left padding.
Changed:
- Updated `src/downloader-ui.ts`:
  - changed downloads column width from `10` to `9` so the header/value alignment no longer appears one character too wide on the left.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual confirmation in `npm run dev` for your terminal width.

## 2026-02-24 20:05 UTC — Exchange 46
Summary: Tightened downloader `Likes` and `Size` column widths by one character each to reduce extra left padding.
Changed:
- Updated `src/downloader-ui.ts`:
  - changed likes column width from `7` to `6`.
  - changed size column width from `6` to `5`.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (7 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual pass in `npm run dev` to confirm all column headers now sit exactly where you want.

## 2026-02-24 20:12 UTC — Exchange 47
Summary: Added downloader cancel confirmation UX and automatic partial-file cleanup for canceled/failed downloads.
Changed:
- Updated `src/downloader-state.ts`:
  - added `cancelConfirmOpen` state flag.
  - added `openCancelConfirm(...)` and `closeCancelConfirm(...)` helpers.
  - ensured phase transitions (`finishDownload`, errors, loading/view transitions) clear cancel confirmation state.
- Updated `src/downloader-ui.ts`:
  - downloading mode now supports a confirm prompt view: `Cancel download and delete partial file?`.
  - footer controls switch to `[Enter] Yes  [Esc] No` while confirm is open.
- Updated `src/tui.ts`:
  - pressing cancel during active download now opens confirm prompt instead of immediate abort.
  - pressing `Esc` again dismisses confirm and resumes download.
  - pressing `Enter` while confirm is open aborts and finalizes cancel flow.
- Updated `src/model-downloader.ts`:
  - `downloadModelFile(...)` now removes partial output file on any failed/incomplete download before re-throwing the original error.
- Added/updated tests:
  - `tests/downloader-state.test.ts` for cancel-confirm state transitions.
  - `tests/downloader-ui.test.ts` for cancel-confirm rendering.
  - `tests/model-downloader.test.ts` for partial-file cleanup on stream failure.
Validation:
- `npm test -- tests/downloader-state.test.ts tests/downloader-ui.test.ts tests/model-downloader.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional interactive check in `npm run dev`: start a large model download, press `Esc` to open confirm, `Esc` to resume, then `Esc` + `Enter` to cancel and verify no partial `.gguf` remains.

## 2026-02-24 20:14 UTC — Exchange 48
Summary: Removed duplicate cancel-confirm options text in downloader popup.
Changed:
- Updated `src/downloader-ui.ts`:
  - cancel-confirm body now renders only the confirmation message (plus a blank spacer row), leaving controls only in the footer.
  - this removes duplicate `[Enter] Yes  [Esc] No` display while preserving downloader frame height.
Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts` — clean (20 passing)
Next:
- Optional visual check in `npm run dev` during an active download to confirm confirm-mode text appears exactly once.

## 2026-02-24 20:27 UTC — Exchange 49
Summary: Reworked downloader Files view into aligned columns, switched file fit wording to GPU-first labels, and applied gradient footer styling to files/downloading/cancel states.
Changed:
- Updated `src/downloader-ui.ts`:
  - added files table layout with aligned columns and header row:
    - `File | Quant | Size | Fit`
  - added `toFileFitLabel(...)` for files-view fit wording:
    - runnable file and size <= VRAM: `Fits on GPU`
    - runnable file and size > VRAM: `Fits on GPU+CPU`
    - non-runnable/unknown paths keep existing reason text behavior
  - retained selected-row highlighting and runnability color cues for non-selected rows.
  - updated files footer commands to pink→yellow gradient styling.
  - updated downloading and cancel-confirm footer lines to render full-line pink→yellow gradients while preserving left/right content alignment.
- Updated `tests/downloader-ui.test.ts`:
  - added files table header/alignment assertions (`File`, `Quant`, `Size`, `Fit`).
  - added fit-label assertions for `Fits on GPU` and non-runnable `Model too large` cases.
  - updated files footer gradient assertion (now gradient, not plain).
  - added gradient assertions for downloading and cancel-confirm footer lines.
Validation:
- `npm test -- tests/downloader-ui.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual pass in `npm run dev` to confirm files-column readability and full-footer gradient appearance in your terminal theme.

## 2026-02-24 20:46 UTC — Exchange 50
Summary: Removed `/keys`, `/build`, and `/todos` from the TypeScript command surface and docs.
Changed:
- Updated `src/commands.ts`:
  - removed `/keys` registration and deleted in-file key diagnostics text constant.
- Updated `src/command-catalog.ts`:
  - removed restored command defaults for `build` and `todos`.
- Updated tests:
  - `tests/commands.test.ts` removed `/keys` registry and output assertions.
  - `tests/command-catalog.test.ts` replaced build override fixture with fetch override fixture.
  - `tests/prompt-composer.test.ts` replaced `/build` autocomplete fixtures with active commands (`/download`, `/dl`).
  - `tests/tui-resize-render.test.ts` replaced `/build` autocomplete fixture with `/download`.
- Updated docs:
  - `docs/guides/getting-started.md` removed `/keys` troubleshooting instruction.
  - `docs/guides/slash-commands.md` removed `/build` and `/todos` from reference and complete list.
  - `docs/changelog.md` removed the unreleased `/keys` added entry.
Validation:
- `npm test -- tests/commands.test.ts tests/command-catalog.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean (62 passing)
- `npm run typecheck` — clean
Next:
- Optional: run full-suite `npm test` and `npm run lint` before committing.

## 2026-02-24 21:16 UTC — Exchange 51
Summary: Implemented dynamic title-box token counter with `/tokens auto` and `/tokens {value}` (manual override), plus exact llama usage ingestion.
Changed:
- Added token counter module `src/token-counter.ts`:
  - `computeAutoMaxTokens(...)` using RAM-after-model heuristic (`ram - model_size - 2GB`) with `4k..128k` clamp.
  - `resolveEffectiveMaxTokens(...)` for auto/manual mode selection.
  - `formatTitleTokenUsage(...)` rendering `x.x/y.yk tks`.
- Expanded config schema in `src/types.ts` and `src/config.ts`:
  - new `AppConfig` fields: `tokensMode` (`auto|manual`) and `tokensManualMax`.
  - defaults: `tokensMode: auto`, `tokensManualMax: 8192`.
  - load/merge/save normalization for both fields (including env overrides).
- Added `/tokens` command in `src/commands.ts`:
  - `/tokens` shows current mode.
  - `/tokens auto` restores automatic max-token mode.
  - `/tokens <value>` sets manual mode (supports `k` suffix, e.g. `32k`).
  - invalid inputs return usage guidance.
- Added `/tokens` to restored command metadata in `src/command-catalog.ts`.
- Updated TUI token usage rendering in `src/tui.ts`:
  - removed placeholder `0/8192`.
  - title-box token usage now computes max tokens from model file size + RAM heuristic in auto mode, or manual max in manual mode.
  - introduced runtime `usedTokensExact` state and reset behavior on session clear.
- Updated llama client usage extraction in `src/llama-client.ts`:
  - `chat(...)` and `streamChat(...)` now return `{ text, usage? }`.
  - parses OpenAI-compatible `usage` totals when present.
  - TUI now updates used token display after responses using exact `total_tokens` only.
- Updated docs:
  - `docs/guides/slash-commands.md` now documents `/tokens` commands.
  - `docs/changelog.md` now includes `/tokens` and dynamic title-box token display behavior.
- Added/updated tests:
  - new `tests/token-counter.test.ts`.
  - updated `tests/commands.test.ts` for `/tokens` behavior.
  - updated `tests/llama-client.test.ts` for `{ text, usage }` return shape and SSE usage parsing.
  - updated `tests/config.test.ts` for token-mode env overrides.
Validation:
- `npm run typecheck` — clean
- `npm test -- tests/llama-client.test.ts tests/commands.test.ts tests/config.test.ts tests/token-counter.test.ts` — clean (53 passing)
- `npm test` — clean (23 files, 236 tests)
- `npm run lint` — clean
- `npm run format:check` — failing due to pre-existing formatting issues across untouched files
Next:
- Run `npm run dev` and verify live title-box token counter behavior across:
  - default auto mode,
  - `/tokens 32k` manual override,
  - `/tokens auto` reset,
  - model-switch changes affecting auto max.

## 2026-02-24 21:34 UTC — Exchange 52
Summary: Refined title token display formatting and made used-token count update on every turn (user input + assistant response).
Changed:
- Updated `src/token-counter.ts`:
  - `formatTitleTokenUsage(...)` now removes redundant trailing `.0` in both used and max segments.
    - examples: `0/32k tks` (instead of `0.0/32.0k tks`), `15.7/32.2k tks` unchanged.
  - added `estimateConversationTokens(...)` (rough estimate: `ceil(chars/4)` per message).
- Updated `src/tui.ts` token-update flow:
  - after each user message append, `usedTokensExact` is recalculated via `estimateConversationTokens(...)`.
  - after each assistant message:
    - if exact backend `total_tokens` is available, it is used.
    - otherwise fallback estimate is recalculated from conversation history.
  - when loading a saved session, token usage now initializes from estimated history usage.
- Updated tests in `tests/token-counter.test.ts`:
  - added no-trailing-`.0` formatting regression.
  - added conversation token estimation coverage.
Validation:
- `npm run typecheck` — clean
- `npm test -- tests/token-counter.test.ts tests/llama-client.test.ts tests/commands.test.ts tests/tui-resize-render.test.ts` — clean (64 passing)
- `npm test` — clean (23 files, 238 tests)
- `npm run lint` — clean
Next:
- Run `npm run dev` and verify live behavior for:
  - initial display `0/<auto-or-manual>k tks`,
  - increment after user submit,
  - increment/replace after assistant response,
  - `/tokens auto` and `/tokens <value>` transitions.

## 2026-02-24 21:35 UTC — Exchange 53
Summary: Adjusted title token usage format so the used side also shows `k` for values >= 1000.
Changed:
- Updated `src/token-counter.ts` formatting:
  - used side now renders with `k` suffix when >= 1000 (`15.7k/32.2k tks`).
  - values < 1000 remain plain integers (`0/32k tks`).
- Updated `tests/token-counter.test.ts` to assert `15.7k/32.2k tks` output.
Validation:
- `npm test -- tests/token-counter.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
Next:
- Optional visual confirmation in `npm run dev` that title usage formatting matches desired display.

## 2026-02-24 21:37 UTC — Exchange 54
Summary: Stopped tracking local workspace config files and ensured they are ignored.
Changed:
- Updated `.gitignore` to include `.yips_config.json`.
- Removed tracked local-only files from git index (kept on disk):
  - `.obsidian/*`
  - `.yips_config.json`
Validation:
- `git status --short` now shows staged deletions from index for `.obsidian/*` and `.yips_config.json`, with ignore rules in place.
Next:
- Commit the ignore cleanup so local workspace/config changes no longer appear in future diffs.

## 2026-02-24 21:44 UTC — Exchange 55
Summary: Reimplemented the pre-response “Thinking ...” loading indicator as a transient animated output-line spinner (ported behavior from yips-cli), including streaming-first-token stop and retry wait coverage.
Changed:
- Updated `src/tui.ts`:
  - imported and integrated `PulsingSpinner` into the Ink runtime via a transient `busySpinnerRef`.
  - added `BUSY_SPINNER_RENDER_INTERVAL_MS` (80ms) and a busy animation render tick so spinner frames/time update while waiting.
  - added `startBusyIndicator(...)` / `stopBusyIndicator()` helpers and replaced direct busy-label toggles in llama request flow.
  - non-streaming requests now show animated `Thinking...` until completion.
  - streaming requests now show animated `Thinking...` until first token arrives, then hide spinner.
  - streaming fallback retry now shows animated `Retrying...` while fallback non-stream request runs.
  - removed busy-label text from prompt status builder, keeping status focused on provider/model.
  - added exported `composeOutputLines(...)` helper and switched output assembly to append transient busy line in output panel.
- Added `tests/tui-busy-indicator.test.ts`:
  - verifies transient busy line is appended after output/autocomplete rows.
  - verifies busy line is omitted when not provided.
  - verifies prompt status text no longer includes `Thinking...` when busy.
Validation:
- `npm test -- tests/tui-busy-indicator.test.ts tests/spinner.test.ts tests/tui-resize-render.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (24 files, 241 tests)
Next:
- Optional manual visual pass with `npm run dev` to confirm the transient busy row behavior feels right in your terminal while waiting for first streaming token.

## 2026-02-24 21:47 UTC — Exchange 56
Summary: Made Model Manager model selection persist before leaving the panel so startup consistently loads the last selected model.
Changed:
- Updated `src/tui.ts` model-manager submit path:
  - replaced fire-and-forget `saveConfig(...)` call with an awaited async flow.
  - added temporary loading state (`Saving selected model...`) while persisting selection.
  - now switches back to chat only after config save succeeds.
  - on save failure, stays in Model Manager and surfaces an inline error (`Failed to save model selection: ...`).
  - preserves existing behavior of setting backend to `llamacpp` and setting `config.model` to selected model id.
Validation:
- `npm test -- tests/tui-resize-render.test.ts tests/commands.test.ts` — clean (51 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional manual check with `npm run dev`: select a model in Model Manager, restart Yips, and confirm the same model is loaded on startup.

## 2026-02-24 21:55 UTC — Exchange 57
Summary: Restored Thinking indicator to ~60fps render updates while keeping spinner glyph cadence stable.
Changed:
- Updated `src/tui.ts`:
  - changed busy animation repaint interval from `80ms` to `16ms` (~60fps) for smoother transient Thinking row animation.
- Updated `src/spinner.ts`:
  - made spinner frame progression time-based (`80ms` per frame) instead of advancing one frame on every render.
  - added internal frame timing state (`lastFrameTime`) and stepped frame advancement based on elapsed wall-clock time.
  - preserves existing pulsing color + elapsed-time display behavior.
- Updated `tests/spinner.test.ts`:
  - adjusted frame-cycling test to mock `Date.now()` and advance by `80ms`, matching time-based frame logic.
Validation:
- `npm test -- tests/spinner.test.ts tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts` — clean (28 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional visual check with `npm run dev` to confirm motion smoothness and spinner cadence in your terminal renderer.

## 2026-02-24 21:59 UTC — Exchange 58
Summary: Fixed Thinking-row ordering and restored smooth yips-cli-style color pulsing.
Changed:
- Updated `src/tui.ts` streaming request path:
  - removed pre-stream empty assistant placeholder append.
  - `blockLength` now starts at `0`, so no timestamped Yips assistant header is rendered above `Thinking...` before first token.
  - first token now inserts the assistant block directly via `replaceOutputBlock(...)`.
- Updated `src/spinner.ts` color animation timing:
  - color pulse now uses fractional elapsed seconds (`(now - startTime) / 1000`) instead of integer seconds.
  - keeps elapsed-time text formatting as whole seconds for display.
  - result: smooth continuous pink↔yellow oscillation matching yips-cli behavior.
- Updated `tests/spinner.test.ts`:
  - added sub-second oscillation regression assertion to verify color changes within fractional seconds.
Validation:
- `npm test -- tests/spinner.test.ts tests/tui-busy-indicator.test.ts tests/tui-resize-render.test.ts` — clean (29 passing)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional manual visual check with `npm run dev` to verify no timestamp/header appears before first streaming token and color pulsing looks right in your terminal.

## 2026-02-24 22:11 UTC — Exchange 59
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

## 2026-02-24 22:14 UTC — Exchange 60
Summary: Restored middle-dot separators in chat prompt footer status while keeping latest `tk/s` throughput suffix.
Changed:
- Updated `src/tui.ts`:
  - changed chat-mode prompt status joiner from `" / "` back to `" · "`.
- Updated `tests/tui-busy-indicator.test.ts`:
  - adjusted throughput footer expectation to `llama.cpp · example · 37.3 tk/s`.
  - updated status-format assertion to expect ` · ` separator.
Validation:
- `npm test -- tests/tui-busy-indicator.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
Next:
- Optional interactive check with `npm run dev` to verify footer visual spacing with the restored middle-dot separators.

## 2026-02-24 22:36 UTC — Exchange 61
Summary: Pushed all local commits on `main` to `origin/main`.
Changed:
- No file content changes; synchronized remote branch state.
Validation:
- `git status -sb` showed `main...origin/main [ahead 15]` before push.
- `git push origin main` — clean (`65b117d..dda9aa3  main -> main`).
Next:
- Continue from updated remote baseline for the next feature or fix.

## 2026-02-24 22:45 UTC — Exchange 62
Summary: Updated upper-layout slicing so output consumes the title/prompt gap first, and only then begins pushing title lines off-screen.
Changed:
- Updated `src/tui.ts`:
  - rewrote `computeVisibleLayoutSlices(...)` to use explicit phases:
    - preserve prompt rows at the bottom,
    - let output fill available gap under the title first,
    - then displace visible title rows,
    - then scroll older output once title is fully displaced.
  - retained output top-padding behavior only when visible output is shorter than the remaining upper area.
- Updated `tests/tui-resize-render.test.ts`:
  - added threshold regression test ensuring the full title remains visible when output exactly fills the gap, and bumping starts only after that point.
Validation:
- `npm test -- tests/tui-resize-render.test.ts` — clean (17 passing)
- `npm run typecheck` — clean
Next:
- Optional interactive verification with `npm run dev` to confirm the gap-fill and title-bump behavior feels correct during live chat output.

## 2026-02-24 22:59 UTC — Exchange 63
Summary: Enforced fresh llama.cpp startup sessions by resetting local server/model residency before TUI launch and failing fast on reset/start errors.
Changed:
- Updated `src/llama-server.ts`:
  - added localhost endpoint detection helpers (`isLocalLlamaEndpoint`, internal hostname normalization).
  - added `resetLlamaForFreshSession(config, overrides?)`:
    - no-op for non-local llama endpoints,
    - stops managed llama-server state,
    - starts a fresh llama-server process/model load for local endpoints.
- Updated `src/tui.ts`:
  - startup now calls `ensureFreshLlamaSessionOnStartup(...)` before rendering Ink UI.
  - added exported `ensureFreshLlamaSessionOnStartup(...)` helper for testable startup preflight logic.
  - startup now throws with formatted diagnostics when local reset/start fails (fail-fast).
  - removed previous startup warning-only preflight effect that allowed continuing after failed startup checks.
- Added tests:
  - `tests/tui-startup-reset.test.ts` for startup preflight behavior (skip non-llama backend, call reset for llama backend, throw on failure).
  - expanded `tests/llama-server.test.ts` for endpoint locality and fresh-session reset behavior.
- Updated `docs/changelog.md` Unreleased `Changed` section with fresh-session startup reset behavior.
Validation:
- `npm test -- tests/llama-server.test.ts tests/tui-startup-reset.test.ts` — clean
- `npm test` — clean (26 files, 262 tests)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional manual runtime check with `npm run dev` to verify expected startup fail-fast behavior when model/binary config is invalid and fresh local model reload behavior when valid.

## 2026-02-24 23:02 UTC — Exchange 64
Summary: Fixed startup regression so Yips no longer fatals when config model is `default` while preserving fresh-session fail-fast behavior for concrete llama models.
Changed:
- Updated `src/tui.ts`:
  - `ensureFreshLlamaSessionOnStartup(...)` now skips startup reset when `config.model` is empty or `default`.
  - keeps existing reset + fail-fast path for explicit configured llama models.
- Updated `tests/tui-startup-reset.test.ts`:
  - added regression test asserting reset is skipped when no concrete model is selected.
  - adjusted reset-path test to use a concrete model id (`qwen.gguf`).
Validation:
- `npm test -- tests/tui-startup-reset.test.ts tests/llama-server.test.ts` — clean
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Re-run `yips` and confirm startup succeeds with `model: "default"`; then select a model via `/model` or `/download` for fresh-session startup reload behavior.

## 2026-02-24 23:07 UTC — Exchange 65
Summary: Fixed model/nickname persistence drift by introducing a canonical config-path override (`YIPS_CONFIG_PATH`) with legacy fallback loading.
Changed:
- Updated `src/config.ts`:
  - added `CONFIG_PATH_ENV_VAR` (`YIPS_CONFIG_PATH`).
  - `resolveConfigPath()` now honors `YIPS_CONFIG_PATH` for default config resolution.
  - `loadConfig()` now attempts canonical resolved path first, then legacy `./.yips_config.json` fallback when default path is env-driven and missing.
  - preserves env overrides while avoiding silent path drift between sessions.
- Updated installer wiring in `install.sh`:
  - changed installer-managed config target to `~/.yips/config.json`.
  - `~/.yips/env.sh` now exports `YIPS_CONFIG_PATH`.
  - env-file rewrite filter now de-duplicates old `YIPS_CONFIG_PATH` entries.
- Updated tests:
  - `tests/config.test.ts` now restores `YIPS_CONFIG_PATH`, verifies env-path persistence behavior, and verifies legacy fallback loading.
  - `tests/commands.test.ts` now restores `YIPS_CONFIG_PATH` to keep command persistence tests isolated.
- Updated docs:
  - `docs/guides/getting-started.md` now documents config loading via `YIPS_CONFIG_PATH` (with `.yips_config.json` fallback behavior).
  - `docs/changelog.md` updated under Unreleased `Changed`.
Validation:
- `npm test -- tests/config.test.ts tests/commands.test.ts` — clean
- `npm test` — clean (26 files, 265 tests)
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Re-source `~/.yips/env.sh` in active shells (or open a new shell) so `YIPS_CONFIG_PATH` is active, then verify `/model` and `/nick` survive restart.

## 2026-02-24 23:12 UTC — Exchange 66
Summary: Removed redundant `/models` command so `/model` is the single Model Manager entrypoint.
Changed:
- Updated `src/commands.ts`:
  - removed `/models` command registration and handler.
- Updated `src/command-catalog.ts`:
  - removed `/models` descriptor from restored command defaults.
- Updated `tests/commands.test.ts`:
  - adjusted command presence expectation to assert `/models` is absent.
  - removed `/models` behavior test.
- Updated docs:
  - `docs/guides/slash-commands.md` command table and complete-list block now omit `/models`.
Validation:
- `npm test -- tests/commands.test.ts tests/command-catalog.test.ts` — clean
- `npm run typecheck` — clean
- `npm run lint` — clean
Next:
- Optional: run `npm run dev` and verify `/model` still opens Model Manager with no args and `/models` now reports unknown command.

## 2026-02-24 23:30 UTC — Exchange 67
Summary: Aligned Model Manager frame styling with Model Downloader for top border gradient/title treatment and gradient footer text.
Changed:
- Updated `src/model-manager-ui.ts`:
  - top border now uses offset-aware gradient rendering (`horizontalGradientAtOffset`) consistent with downloader framing.
  - title rendering now matches downloader style with bold brand/title segment and matching trailing title spacing.
  - top-right corner now uses gradient-at-offset instead of a single fixed corner color.
  - footer command line inside the box now uses pink→yellow horizontal gradient text, matching downloader footer styling.
Validation:
- `npm test -- tests/model-manager-ui.test.ts` — clean (3 passing)
- `npm run lint -- src/model-manager-ui.ts` — clean
- `npm run typecheck` — clean
Next:
- Optional visual pass in `npm run dev` to confirm Model Manager and Model Downloader frames look identical in-terminal at multiple widths.
