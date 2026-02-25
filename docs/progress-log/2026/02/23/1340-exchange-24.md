## 2026-02-23 13:40 MST — Exchange 24

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
