## 2026-02-23 21:35 MST — Exchange 62

Summary: Hardened Arch installer behavior to avoid partial-upgrade breakage and auto-repair broken Node runtime linkage before npm install.
Changed:

- Updated `install.sh` pacman workflow:
  - replaced sync-only installs with full-upgrade semantics on first pacman invocation (`pacman -Syu --needed --noconfirm ...`)
  - subsequent pacman installs in same run use `pacman -S --needed --noconfirm ...`
- Added Node runtime health checks:
  - validates `node -v` and `npm -v` executability (not just command presence)
  - captures diagnostics for linker/runtime failures
- Added Arch self-heal path for broken Node linkage:
  - auto-runs `pacman -Syu --needed nodejs npm simdjson`
  - rechecks runtime health and exits with actionable manual commands if still broken
- Updated docs:
  - `docs/guides/getting-started.md` now notes Arch full-upgrade behavior and Node self-heal
  - `docs/changelog.md` includes Arch pacman/runtime hardening notes
    Validation:
- `bash -n install.sh` — clean
- `./install.sh --help` — clean
- Note: npm/typecheck/test were not run in-session because current environment has broken Node shared-library linkage (the exact condition this patch is intended to recover).
  Next:
- Add optional `--dry-run` mode so package actions and repair branches can be validated in CI without privileged changes.
