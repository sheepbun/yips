# Automatic Git Versioning

This repository uses automatic version numbering based on git commits.

- **Format**: vYYYY.MM.DD-SHORTHASH
- **Example**: v2026.01.31-134ae0f
- **Usage**: Run `python version.py` to see the current version

The version is calculated dynamically from the latest git commit, so it always stays in sync with the repository state.
