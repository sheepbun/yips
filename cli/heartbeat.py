#!/usr/bin/env python3
"""
heartbeat.py - Background monitoring for Yips.

Wakes up periodically to check for linting errors and failed tests.
"""

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.append(str(PROJECT_ROOT))

from cli.config import DOT_YIPS_DIR

HEARTBEAT_LOG = DOT_YIPS_DIR / "heartbeat.log"

def run_checks():
    DOT_YIPS_DIR.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] Running heartbeat checks...\n"
    
    # Try to run the BUILD skill
    build_path = PROJECT_ROOT / "commands" / "tools" / "BUILD" / "BUILD.py"
    if build_path.exists():
        try:
            result = subprocess.run(
                [sys.executable, str(build_path)],
                capture_output=True,
                text=True,
                cwd=PROJECT_ROOT
            )
            log_entry += f"Build status: {'Success' if result.returncode == 0 else 'Failed'}\n"
            if result.returncode != 0:
                log_entry += f"Errors detected:\n{result.stdout}\n"
        except Exception as e:
            log_entry += f"Error running BUILD skill: {e}\n"
    
    # Scan for TODOs
    try:
        todo_scan = subprocess.run(
            ["grep", "-rn", "TODO", str(PROJECT_ROOT)],
            capture_output=True,
            text=True
        )
        if todo_scan.stdout:
            todos = todo_scan.stdout.splitlines()
            log_entry += f"Found {len(todos)} TODOs in codebase.\n"
    except Exception:
        pass
        
    with open(HEARTBEAT_LOG, "a") as f:
        f.write(log_entry + "-" * 40 + "\n")

if __name__ == "__main__":
    run_checks()
