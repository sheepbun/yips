#!/bin/bash
# Yips CLI Launcher

PROJECT_ROOT="/home/katherine/Yips"
cd "$PROJECT_ROOT"

# Run the Python CLI
export YIPS_PERSIST_BACKEND=1
exec ./.venv/bin/python3 -m cli.main "$@"
