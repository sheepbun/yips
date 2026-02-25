## 2026-02-25 06:37 MST — Exchange 161

Summary: Implemented Milestone 5 first-cut packaging/update path (npm + install.sh), added guided `/update` command, and restored repository-wide green baseline by removing the stale duplicate resize test file.
Changed:

- Baseline stabilization:
  - removed legacy duplicate `tests/tui-resize-render.test.ts` with stale root-import paths
  - retained canonical `tests/ui/tui/tui-resize-render.test.ts` coverage
- Added update-check runtime:
  - added `src/app/update-check.ts` with npm-registry latest-version lookup and semver comparison
  - added `/update` command handler in `src/agent/commands/commands.ts` with guided upgrade commands (`npm install -g yips@latest`, source reinstall path, `https://yips.dev`)
  - added command metadata entry for `/update` in `src/agent/commands/command-catalog.ts`
- Added tests:
  - new `tests/app/update-check.test.ts`
  - expanded `tests/agent/commands/commands.test.ts` for `/update` behavior and autocomplete/catalog coverage
- Packaging/release metadata:
  - updated `package.json` with `bin` (`yips`), publish `files`, and repository/homepage/bugs metadata
  - added Node shebang to `src/app/index.ts` for npm global-bin execution
  - added `.github/workflows/release.yml` for tag/manual release validation + npm publish + GitHub release generation
- Docs updates for Milestone 5 state:
  - `docs/roadmap.md` marks Milestone 5 items complete with explicit scope
  - `docs/stack.md` records distribution decision (npm + install.sh) and WSL2 platform policy
  - `docs/guides/getting-started.md` documents npm install path and `/update`
  - `docs/guides/slash-commands.md` includes `/update`
  - `docs/changelog.md` updated with unreleased packaging/update entries

Validation:

- `npm run typecheck` — clean
- `npm test` — clean (50 files, 399 tests)
- `npm run build` — clean
- `npm test -- tests/app/update-check.test.ts tests/agent/commands/commands.test.ts` — clean

Next:

- Cut and test a tagged release (`v*`) with configured `NPM_TOKEN` to validate end-to-end publish/release automation in GitHub Actions.
