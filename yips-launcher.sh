#!/bin/bash
# Yips CLI Launcher

PROJECT_ROOT="/home/katherine/Yips"
cd "$PROJECT_ROOT"

# Run the Python CLI
exec ./.venv/bin/python3 -m cli.main "$@"
