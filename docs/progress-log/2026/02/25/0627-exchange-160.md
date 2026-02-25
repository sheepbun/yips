## 2026-02-25 06:27 MST — Exchange 160

Summary: Formalized gateway headless backend policy as llama.cpp-only with explicit runtime override, startup validation, and headless backend override threading.
Changed:

- Added `src/gateway/runtime/backend-policy.ts`:
  - adds `YIPS_GATEWAY_BACKEND` resolution with default `llamacpp`
  - rejects unsupported backend values with fail-fast startup error text
- Updated `src/gateway/runtime/discord-main.ts`:
  - resolves `YIPS_GATEWAY_BACKEND` at startup via backend-policy module
  - passes resolved backend into `createGatewayHeadlessMessageHandler(...)`
- Updated `src/gateway/headless-conductor.ts`:
  - added `GatewayHeadlessConductorOptions.gatewayBackend`
  - backend gate now uses explicit gateway backend override when provided
  - retained defensive unsupported-backend response guardrail
- Added tests:
  - new `tests/gateway/runtime/backend-policy.test.ts` for default/valid/invalid backend policy behavior
  - expanded `tests/gateway/headless-conductor.test.ts` with non-llama app config + llama gateway override path
- Updated docs:
  - `docs/guides/gateway.md` with `YIPS_GATEWAY_BACKEND` env var and fail-fast behavior
  - `docs/changelog.md` unreleased entry for gateway backend policy formalization

Validation:

- `npm run lint` — clean
- `npm test -- tests/gateway/runtime/backend-policy.test.ts tests/gateway/headless-conductor.test.ts` — clean (9 tests)
- `npm run build` — clean
- `npm run typecheck` — fails due to pre-existing unresolved legacy imports in `tests/tui-resize-render.test.ts` (`../src/prompt-box`, `../src/prompt-composer`, `../src/tui`, `../src/title-box`)
- `npm test` — fails due to same pre-existing suite (`tests/tui-resize-render.test.ts`); all other suites pass (49 passed, 1 failed)

Next:

- Clean up or remove legacy root-level `tests/tui-resize-render.test.ts` imports so repository-wide `typecheck` and full `npm test` return to green.
