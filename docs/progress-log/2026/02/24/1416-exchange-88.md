## 2026-02-24 14:16 MST — Exchange 88

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
