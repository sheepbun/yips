## 2026-02-25 04:58 MST — Exchange 150

Summary: Refactored the TypeScript rewrite into a domain-first `src/` tree for agent navigation, mirrored `tests/` to the same layout, introduced runtime-safe `#imports` aliases, and added project tree documentation.
Changed:

- Reorganized `src/` from flat modules to domain directories:
  - `src/app`: `index.ts`, `repl.ts`, `version.ts`
  - `src/agent`: `conductor`, `commands`, `context`, `protocol`, `skills`, `tools`
  - `src/config`: `config.ts`, `hooks.ts`
  - `src/llm`: `llama-client.ts`, `llama-server.ts`, `token-counter.ts`
  - `src/models`: `hardware.ts`, `model-downloader.ts`, `model-manager.ts`
  - `src/types`: `app-types.ts`
  - `src/ui`: rendering/input/downloader/model-manager/prompt/tui modules
- Reorganized `tests/` to mirror source domains (`tests/app`, `tests/agent`, `tests/config`, `tests/llm`, `tests/models`, `tests/ui`).
- Migrated internal imports and test imports to Node `#imports` alias paths.
- Updated runtime/compile entry paths:
  - `package.json` scripts now use `src/app/index.ts` (`dev`) and `dist/app/index.js` (`start`/`main`).
  - `install.sh` launcher now runs `src/app/index.ts` in source mode and `dist/app/index.js` in dist mode.
- Added runtime-safe alias configuration:
  - `package.json#imports` with `development` (src) and `default` (dist) mappings.
  - `tsconfig.json` `customConditions` + `paths` aligned with alias map.
- Added TUI helper modules under `src/ui/tui`:
  - `constants.ts`, `runtime-utils.ts`, `history.ts`, `layout.ts`, `autocomplete.ts`
  - `src/ui/tui/start-tui.ts` now re-exports helper APIs from these focused modules.
- Fixed versioning regression after path move:
  - `src/app/version.ts` repo root resolution updated to `resolve(__dirname, "../..")`.
- Documentation updates:
  - Added `docs/project-tree.md` with canonical `src/` and `tests/` map plus alias guide.
  - Updated `docs/README.md` documentation map to include Project Tree.
  - Updated `docs/architecture.md` with a new Codebase Layout section.
  - Updated `docs/guides/getting-started.md` dist path note and added Project Tree next-step link.
  - Updated `docs/changelog.md` unreleased section with refactor notes.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (37 files, 340 tests)
- `npm run build` — clean
- `printf '/exit\n' | npm run dev -- --no-tui` — clean
- `printf '/exit\n' | npm start -- --no-tui` — clean
- `npm run format:check` — fails due existing/pre-existing formatting drift across multiple files (not newly introduced by this exchange)

Next:

- Optionally run `npm run format` in a dedicated formatting-only pass if you want the repository to satisfy `format:check` as a hard gate.
