#!/bin/bash
# Yips CLI Launcher (Portable)

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Run the unified startup script
exec ./startup.sh "$@"
