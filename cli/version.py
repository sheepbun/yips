#!/usr/bin/env python3
"""
Version management for Yips.

Automatically generates date-based versions from git commits.
Format: vYYYY.M.D-SHORTHASH

Usage:
    python version.py              # Display current version
    import version; print(version.__version__)  # Get version in Python
"""

import subprocess
from datetime import datetime
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


def get_git_info() -> Optional[tuple[datetime, str]]:
    """
    Get commit date and SHA from latest commit.
    Returns (datetime, short_sha) or None if no commits.
    """
    try:
        # Get commit timestamp
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ct"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        timestamp = int(result.stdout.strip())
        commit_date = datetime.fromtimestamp(timestamp)

        # Get short SHA
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        short_sha = result.stdout.strip()
        return (commit_date, short_sha)

    except Exception:
        return None


def generate_version(commit_date: datetime, short_sha: str) -> str:
    """
    Generate version string from commit info.
    Format: vYYYY.M.D-SHORTHASH
    """
    return f"v{commit_date.year}.{commit_date.month}.{commit_date.day}-{short_sha}"


def get_version() -> str:
    """
    Get current version dynamically from git, or fallback to default.
    This is calculated on-the-fly, not stored in a file.
    """
    git_info = get_git_info()
    if git_info:
        commit_date, short_sha = git_info
        return generate_version(commit_date, short_sha)
    return "1.0.0"  # Fallback version when git is not available


# Module-level version that's calculated when imported
__version__ = get_version()


def main() -> None:
    """CLI interface for version management."""
    print(get_version())


if __name__ == "__main__":
    main()
