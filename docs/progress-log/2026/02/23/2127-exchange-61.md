## 2026-02-23 21:27 MST — Exchange 61

Summary: Added explicit opt-in CUDA install flag (`--cuda`) to installer.
Changed:

- Updated `install.sh`:
  - added argument parsing with `--cuda` and `--help`
  - added CUDA toolkit install step gated by `--cuda`
  - package mapping for CUDA toolkit install:
    - `apt`: `nvidia-cuda-toolkit`
    - `pacman`: `cuda`
    - `dnf`: `cuda`
  - default install behavior remains unchanged unless `--cuda` is passed
- Updated docs:
  - `docs/guides/getting-started.md` now documents `./install.sh --cuda`
  - `docs/changelog.md` updated with `--cuda` support note
    Validation:
- `bash -n install.sh` — clean
- `./install.sh --help` output verified
  Next:
- Add `--dry-run` mode to validate package actions in CI without privileged installs.
