## 2026-02-23 21:20 MST — Exchange 59

Summary: Added Arch Linux `pacman` support to `install.sh` and updated setup docs accordingly.
Changed:

- Updated `install.sh` package manager detection to include `pacman`.
- Added `install_packages_pacman()` helper using `pacman -Sy --needed --noconfirm`.
- Added Arch dependency mapping in prerequisite install flow:
  - `git cmake base-devel curl nodejs npm`
- Updated `docs/guides/getting-started.md` to list `pacman` among supported package managers for automated install.
  Validation:
- Script logic review for package-manager dispatch path (`apt`/`pacman`/`dnf`/`brew`) completed.
  Next:
- Optionally add a non-destructive `--dry-run` mode to `install.sh` and validate pacman branch in CI without root installs.
