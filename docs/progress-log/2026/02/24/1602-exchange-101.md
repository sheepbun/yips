## 2026-02-24 16:02 MST — Exchange 101

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
