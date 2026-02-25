## 2026-02-24 16:07 MST — Exchange 102

Summary: Fixed model/nickname persistence drift by introducing a canonical config-path override (`YIPS_CONFIG_PATH`) with legacy fallback loading.
Changed:

- Updated `src/config.ts`:
  - added `CONFIG_PATH_ENV_VAR` (`YIPS_CONFIG_PATH`).
  - `resolveConfigPath()` now honors `YIPS_CONFIG_PATH` for default config resolution.
  - `loadConfig()` now attempts canonical resolved path first, then legacy `./.yips_config.json` fallback when default path is env-driven and missing.
  - preserves env overrides while avoiding silent path drift between sessions.
- Updated installer wiring in `install.sh`:
  - changed installer-managed config target to `~/.yips/config.json`.
  - `~/.yips/env.sh` now exports `YIPS_CONFIG_PATH`.
  - env-file rewrite filter now de-duplicates old `YIPS_CONFIG_PATH` entries.
- Updated tests:
  - `tests/config.test.ts` now restores `YIPS_CONFIG_PATH`, verifies env-path persistence behavior, and verifies legacy fallback loading.
  - `tests/commands.test.ts` now restores `YIPS_CONFIG_PATH` to keep command persistence tests isolated.
- Updated docs:
  - `docs/guides/getting-started.md` now documents config loading via `YIPS_CONFIG_PATH` (with `.yips_config.json` fallback behavior).
  - `docs/changelog.md` updated under Unreleased `Changed`.
    Validation:
- `npm test -- tests/config.test.ts tests/commands.test.ts` — clean
- `npm test` — clean (26 files, 265 tests)
- `npm run typecheck` — clean
- `npm run lint` — clean
  Next:
- Re-source `~/.yips/env.sh` in active shells (or open a new shell) so `YIPS_CONFIG_PATH` is active, then verify `/model` and `/nick` survive restart.
