## 2026-02-23 21:48 MST — Exchange 64

Summary: Fixed `yips` launcher staleness by defaulting launcher execution to source mode instead of stale `dist` artifacts.
Changed:

- Updated `install.sh` launcher generation:
  - launcher now defaults to `npm run dev -- "$@"` for latest local source behavior
  - `dist/index.js` is only used when explicitly requested via `YIPS_USE_DIST=1`
  - added inline launcher comments documenting default and override behavior
- Updated docs:
  - `docs/guides/getting-started.md` notes launcher default source-mode behavior and `YIPS_USE_DIST=1` override
  - `docs/changelog.md` includes launcher-mode update note
    Validation:
- `bash -n install.sh` — clean
  Next:
- Regenerate user launcher by re-running `./install.sh` (or update `~/.local/bin/yips` manually) so existing local launcher picks up the new logic.
