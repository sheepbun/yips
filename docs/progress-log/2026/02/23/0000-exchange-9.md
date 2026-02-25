## 2026-02-23 00:00 MST — Exchange 9

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
