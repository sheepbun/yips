## 2026-02-22 21:36 MST — Exchange 20

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
