## 2026-02-24 12:06 MST — Exchange 72

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
