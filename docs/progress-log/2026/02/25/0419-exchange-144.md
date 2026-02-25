## 2026-02-25 04:19 MST — Exchange 144

Summary: Fixed incorrect launch cwd behavior by updating the generated `yips` launcher to preserve caller working directory instead of forcing repo root.
Changed:

- Updated `install.sh` (`install_yips_launcher`):
  - removed `cd "${REPO_ROOT}"` from the generated launcher.
  - dist mode now executes via absolute path: `node "${REPO_ROOT}/dist/index.js"`.
  - source mode now executes via absolute `tsx` CLI path: `node "${REPO_ROOT}/node_modules/tsx/dist/cli.mjs" "${REPO_ROOT}/src/index.ts"`.
  - added explicit launcher error when local `tsx` runtime is missing with remediation hint.
  - retained `REPO_ROOT` existence guard.
- Updated `install.sh` summary output (`print_summary`):
  - replaced repo-root-only next steps with `Run: yips` and note that launch cwd is preserved.

Validation:

- `bash -n install.sh` — clean
- `npm test -- tests/tui-resize-render.test.ts` — clean (26 passing)

Next:

- Re-run `./install.sh` (or reinstall the launcher) to regenerate `~/.local/bin/yips` with the new no-`cd` behavior.
