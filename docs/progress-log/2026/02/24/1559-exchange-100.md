## 2026-02-24 15:59 MST — Exchange 100

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
