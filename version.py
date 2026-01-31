#!/usr/bin/env python3
"""
Version management for Yips.

Automatically generates date-based versions from git commits.
Format: vYYYY.MM.DD-SHORTHASH

Usage:
    python version.py              # Display current version
    python version.py update       # Update version from latest commit
"""

import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from root import PROJECT_ROOT

AGENT_PY = PROJECT_ROOT / "AGENT.py"


def get_current_version() -> str:
    """Read current version from AGENT.py."""
    content = AGENT_PY.read_text()
    match = re.search(r'^APP_VERSION = ["\']([^"\']+)["\']', content, re.MULTILINE)
    if match:
        return match.group(1)
    return "unknown"


__version__ = get_current_version()


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
    Format: vYYYY.MM.DD-SHORTHASH
    """
    return f"v{commit_date.strftime('%Y.%m.%d')}-{short_sha}"


def update_agent_version(new_version: str) -> bool:
    """Update APP_VERSION in AGENT.py."""
    try:
        content = AGENT_PY.read_text()

        # Replace the version line
        updated = re.sub(
            r'^APP_VERSION = ["\'][^"\']+["\']',
            f'APP_VERSION = "{new_version}"',
            content,
            count=1,
            flags=re.MULTILINE
        )

        if updated != content:
            AGENT_PY.write_text(updated)
            return True
        return False
    except Exception as e:
        print(f"Error updating version: {e}", file=sys.stderr)
        return False


def main():
    """CLI interface for version management."""
    if len(sys.argv) == 1:
        # Display current version
        print(get_current_version())
        return

    if sys.argv[1] == "update":
        # Update version from latest commit
        git_info = get_git_info()
        if not git_info:
            print("No git commits found, keeping current version")
            return

        commit_date, short_sha = git_info
        new_version = generate_version(commit_date, short_sha)
        current = get_current_version()

        if new_version == current:
            print(f"Version already up to date: {current}")
        else:
            if update_agent_version(new_version):
                print(f"Updated version: {current} → {new_version}")
            else:
                print("No changes made")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
