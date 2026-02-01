"""
Project root detection for Yips.

Provides a robust method to find the project root directory using multiple
strategies, ensuring the project works regardless of how it's invoked.
"""

from pathlib import Path
import os


def find_project_root() -> Path:
    """
    Find the Yips project root directory using multiple strategies.

    Returns the first matching directory from:
    1. YIPS_ROOT environment variable
    2. .yips-root marker file
    3. .git directory (VCS marker)
    4. AGENT.py file (main entry point)
    5. Fallback to __file__ parent directory
    """

    # Strategy 1: Environment variable (highest priority)
    if env_root := os.environ.get("YIPS_ROOT"):
        root = Path(env_root).resolve()
        if root.exists():
            return root

    # Strategy 2: Look for .yips-root marker file
    current = Path(__file__).resolve().parent
    for parent in [current, *current.parents]:
        if (parent / ".yips-root").exists():
            return parent

    # Strategy 3: Look for .git directory
    current = Path(__file__).resolve().parent
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent

    # Strategy 4: Search upward for AGENT.py (main entry point)
    current = Path(__file__).resolve().parent
    for parent in [current, *current.parents]:
        if (parent / "AGENT.py").exists():
            return parent

    # Strategy 5: Fallback to __file__ parent (current behavior)
    return Path(__file__).resolve().parent


# Export as module constant for easy importing
PROJECT_ROOT = find_project_root()
