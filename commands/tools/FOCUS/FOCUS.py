#!/usr/bin/env python3
"""
FOCUS - Set the current focus area for Yips.

Usage:
    /focus <description>
"""

import sys
from pathlib import Path
from cli.config import DOT_YIPS_DIR

FOCUS_FILE = DOT_YIPS_DIR / "FOCUS.md"

def set_focus(description):
    DOT_YIPS_DIR.mkdir(parents=True, exist_ok=True)
    FOCUS_FILE.write_text(description)
    return f"Focus area updated: {description}"

def main():
    if len(sys.argv) < 2:
        print("Usage: /focus <description>")
        sys.exit(1)
        
    description = " ".join(sys.argv[1:])
    print(set_focus(description))

if __name__ == "__main__":
    main()
