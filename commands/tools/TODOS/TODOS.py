#!/usr/bin/env python3
"""
TODOS - Scan for TODOs in the codebase.
"""

import subprocess
import sys
from pathlib import Path

def scan_todos():
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    try:
        # Use grep to find TODOs, excluding .git and other noise
        result = subprocess.run(
            ["grep", "-rn", "--exclude-dir=.git", "--exclude-dir=.yips", "TODO", str(project_root)],
            capture_output=True,
            text=True
        )
        if result.stdout:
            return result.stdout
        return "No TODOs found."
    except Exception as e:
        return f"Error scanning for TODOs: {e}"

def main():
    print("Scanning for TODOs...")
    print("-" * 40)
    print(scan_todos())

if __name__ == "__main__":
    main()
