#!/usr/bin/env python3
"""
BUILD - Build pipeline awareness for Yips.

Detects and runs the appropriate build system for the current directory.
"""

import os
import subprocess
import sys
from pathlib import Path

def detect_and_build():
    cwd = Path.cwd()
    
    # Check for common build files
    if (cwd / "package.json").exists():
        print("Detected Node.js project. Running 'npm run build'...")
        return run_build("npm run build")
    elif (cwd / "Cargo.toml").exists():
        print("Detected Rust project. Running 'cargo build'...")
        return run_build("cargo build")
    elif (cwd / "Makefile").exists() or (cwd / "makefile").exists():
        print("Detected Makefile. Running 'make'...")
        return run_build("make")
    elif (cwd / "requirements.txt").exists() or (cwd / "setup.py").exists():
        print("Detected Python project. Running 'pyright' or 'ruff' check...")
        # For python, "build" is often linting/typing
        if subprocess.run("command -v pyright", shell=True, capture_output=True).returncode == 0:
             return run_build("pyright")
        elif subprocess.run("command -v ruff", shell=True, capture_output=True).returncode == 0:
             return run_build("ruff check .")
        else:
             print("No common Python linter found. Attempting 'python3 -m compileall .'")
             return run_build("python3 -m compileall .")
    else:
        print("No recognized build system found in current directory.")
        return 1, "No build system detected."

def run_build(command):
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300 # 5 minutes
        )
        
        output = result.stdout
        if result.stderr:
            output += f"\n[stderr]:\n{result.stderr}"
            
        if result.returncode != 0:
            print(f"Build failed with exit code {result.returncode}")
        else:
            print("Build successful.")
            
        return result.returncode, output
    except subprocess.TimeoutExpired:
        return 1, "Build timed out after 5 minutes."
    except Exception as e:
        return 1, f"Error during build: {e}"

def main():
    code, output = detect_and_build()
    print("-" * 40)
    print(output)
    sys.exit(code)

if __name__ == "__main__":
    main()
