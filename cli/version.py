#!/usr/bin/env python3
"""Version management for Yips.

Version resolution order:
1. ``package.json`` — the canonical source (matches the npm release).
   Resolved from ``sys._MEIPASS`` when running as a PyInstaller onefile
   binary, otherwise from the project root.
2. ``git rev-list --count HEAD`` — dev fallback when ``package.json`` is
   absent (useful in worktrees between releases).
3. ``v0.0.0`` — last-resort fallback.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Optional


def _get_project_root() -> Path:
    """Helper to get the project root path."""
    try:
        from root import PROJECT_ROOT
        return PROJECT_ROOT
    except ImportError:
        return Path(__file__).parent


PROJECT_ROOT = _get_project_root()


def _package_json_path() -> Optional[Path]:
    """Locate ``package.json`` for frozen and source trees."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        bundled = Path(sys._MEIPASS) / "package.json"  # type: ignore[attr-defined]
        if bundled.exists():
            return bundled

    source = Path(__file__).resolve().parent.parent / "package.json"
    if source.exists():
        return source
    return None


def _version_from_package_json() -> Optional[str]:
    """Return ``v<version>`` from ``package.json`` or ``None`` if unavailable."""
    path = _package_json_path()
    if path is None:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    version = data.get("version")
    if not isinstance(version, str) or not version:
        return None
    return f"v{version}"


def get_commit_count() -> Optional[int]:
    """Return the total number of commits present in the repository."""
    try:
        result = subprocess.run(
            ["git", "rev-list", "--count", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        return int(result.stdout.strip())
    except Exception:
        return None


def version_from_commits(count: int) -> str:
    """Convert a commit count to a `vMAJOR.MINOR.PATCH` string with patch/minor capped at 99 before rollover."""
    patch = count % 100
    minor = (count // 100) % 100
    major = count // 10000
    return f"v{major}.{minor}.{patch}"


def get_version() -> str:
    """Return the version string, preferring ``package.json``."""
    pkg = _version_from_package_json()
    if pkg is not None:
        return pkg
    count = get_commit_count()
    if count is not None:
        return version_from_commits(count)
    return "v0.0.0"


__version__ = get_version()


def main() -> None:
    """CLI interface for version management."""
    print(get_version())


if __name__ == "__main__":
    main()
