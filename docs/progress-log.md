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
