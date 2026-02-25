## 2026-02-23 21:38 MST — Exchange 63

Summary: Extended installer to add a global `yips` launcher path for running from any directory.
Changed:

- Updated `install.sh`:
  - adds `YIPS_BIN_DIR=~/.local/bin` and creates the directory during install
  - writes env exports in `~/.yips/env.sh`:
    - `YIPS_BIN_DIR`
    - `PATH="$YIPS_BIN_DIR:$PATH"`
  - installs executable launcher at `~/.local/bin/yips`
    - launcher enters repo root and runs `node dist/index.js` when present
    - otherwise falls back to `npm run dev -- "$@"`
  - summary now prints launcher path
- Updated docs:
  - `docs/guides/getting-started.md` now uses `yips` after install
  - `docs/changelog.md` notes launcher + PATH support
    Validation:
- `bash -n install.sh` — clean
  Next:
- Optionally add a `--global-link` mode for users who prefer `/usr/local/bin/yips` instead of `~/.local/bin/yips`.
