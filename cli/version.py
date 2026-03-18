#!/usr/bin/env python3
"""
Version management for Yips.

Generates MAJOR.MINOR.PATCH versions derived from the total git commit count
so every commit adds +0.0.1 (rolls into +0.1.0 and +1.0.0 as digits overflow).

Usage:
    python version.py              # Display current version
    import version; print(version.__version__)  # Get version in Python
"""

import subprocess
from pathlib import Path
from typing import Optional


def _get_project_root() -> Path:
    """Helper to get the project root path."""
    try:
        from root import PROJECT_ROOT
        return PROJECT_ROOT
    except ImportError:
        # Fallback if root.py isn't available
        return Path(__file__).parent


PROJECT_ROOT = _get_project_root()


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
    """Convert a commit count to a MAJOR.MINOR.PATCH string prefixed with v."""
    major = count // 100
    minor = (count // 10) % 10
    patch = count % 10
    return f"v{major}.{minor}.{patch}"


def get_version() -> str:
    """Return version derived from git commit count or fallback."""
    count = get_commit_count()
    if count is not None:
        return version_from_commits(count)
    return "v0.0.0"


# Module-level version that's calculated when imported
__version__ = get_version()


def main() -> None:
    """CLI interface for version management."""
    print(get_version())


if __name__ == "__main__":
    main()
