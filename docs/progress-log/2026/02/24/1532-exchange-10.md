## 2026-02-24 15:32 MST — Exchange 10

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
