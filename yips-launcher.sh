#!/bin/bash
# Yips CLI Launcher (Portable)

# Resolve the project root even if called via symlink
SCRIPT_PATH=$(readlink -f "$0")
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
cd "$PROJECT_ROOT"

# Run the unified startup script
exec ./startup.sh "$@"
