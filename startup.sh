#!/bin/bash
# Yips Portable Startup Script
# This script automatically detects the project root, runs the setup, and launches Yips.

# 1. Detect project root dynamically
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 2. Run the auto-installer/updater
if [ -f "scripts/setup.sh" ]; then
    chmod +x scripts/setup.sh
    ./scripts/setup.sh
else
    echo "Error: scripts/setup.sh not found."
    exit 1
fi

# 3. Launch the agent
# Ensure we use the virtual environment created by setup.sh
if [ -f ".venv/bin/python3" ]; then
    export YIPS_PERSIST_BACKEND=1
    export YIPS_USER_CWD="$(pwd)"
    exec ./.venv/bin/python3 -m cli.main "$@"
else
    echo "Error: Virtual environment not found. Setup may have failed."
    exit 1
fi
