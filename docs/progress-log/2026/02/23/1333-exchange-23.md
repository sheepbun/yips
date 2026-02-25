## 2026-02-23 13:33 MST — Exchange 23

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
