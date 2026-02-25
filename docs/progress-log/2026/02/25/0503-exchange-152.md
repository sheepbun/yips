## 2026-02-25 05:03 MST — Exchange 152

Summary: Repaired stale user-installed launcher script so `yips` points to post-refactor entrypoints.
Changed:

- Updated local launcher at `~/.local/bin/yips` to use:
  - source mode entry: `src/app/index.ts`
  - dist mode entry: `dist/app/index.js`
- No repository source-code changes were required for runtime behavior; this was an installed-script drift fix.

Validation:

- `cd /home/katherine/workspace/software && printf '/exit\\n' | yips --no-tui` — clean
- `cd /home/katherine/workspace/software && printf '/exit\\n' | YIPS_USE_DIST=1 yips --no-tui` — clean

Next:

- Optional: rerun `./install.sh` to regenerate launcher from script if you want installer-managed parity on this machine.
