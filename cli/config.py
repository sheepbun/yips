"""
Configuration management for Yips CLI.

Handles loading and saving user configuration, paths, and constants.
"""

import json
import os
import shutil
from pathlib import Path

from cli.root import PROJECT_ROOT
from cli.type_defs import YipsConfig

# 1. Source/Code Root (where the binary/bundle is)
SOURCE_ROOT = PROJECT_ROOT
BASE_DIR = PROJECT_ROOT
COMMANDS_DIR = SOURCE_ROOT / "commands"
SKILLS_DIR = COMMANDS_DIR / "skills"
TOOLS_DIR = COMMANDS_DIR / "tools"

# 2. User Data Root (persistent and writable)
if os.name == "nt":
    USER_DATA_ROOT = Path(os.environ.get("APPDATA", "")) / ".yips"
else:
    USER_DATA_ROOT = Path.home() / ".yips"

# Move config and logs to the user data root
DOT_YIPS_DIR = USER_DATA_ROOT
MEMORIES_DIR = DOT_YIPS_DIR / "memory"
PLANS_DIR = DOT_YIPS_DIR / "plans"
CONFIG_FILE = DOT_YIPS_DIR / "config.json"

# Working Zone (where the agent operates)
WORKING_ZONE = PROJECT_ROOT

# Application info
APP_NAME = "Yips"

# Claude CLI Configuration
CLAUDE_CLI_MODEL = "claude-3-5-sonnet-20240620"
CLAUDE_CLI_PATH = os.environ.get("CLAUDE_CLI_PATH", shutil.which("claude") or "claude")

# Import version dynamically
def _get_app_version() -> str:
    try:
        from cli.version import __version__
        return __version__
    except ImportError:
        return "1.0.0"

APP_VERSION = _get_app_version()

# Layout mode thresholds for responsive title box
LAYOUT_FULL_MIN_WIDTH = 80
LAYOUT_SINGLE_MIN_WIDTH = 60
LAYOUT_COMPACT_MIN_WIDTH = 45
LAYOUT_MINIMAL_MIN_WIDTH = 35

# Default autonomous depth limit
DEFAULT_MAX_DEPTH = 5

# Internal reprompt message for ReAct loop
INTERNAL_REPROMPT = "Observation received. Please proceed."


def load_config() -> YipsConfig:
    """Load saved configuration from file."""
    # 1. Try new location in home directory
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    # 2. Fallback to old location in project root (for migration)
    old_config = SOURCE_ROOT / ".yips_config.json"
    if old_config.exists():
        try:
            return json.loads(old_config.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    return {}


def save_config(config: YipsConfig) -> None:
    """Save configuration to file."""
    try:
        DOT_YIPS_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
    except OSError:
        pass
