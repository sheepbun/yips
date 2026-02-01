"""
Configuration management for Yips CLI.

Handles loading and saving user configuration, paths, and constants.
"""

import json

from cli.root import PROJECT_ROOT
from cli.type_defs import YipsConfig

# Directory paths
BASE_DIR = PROJECT_ROOT
MEMORIES_DIR = BASE_DIR / "memories"
SKILLS_DIR = BASE_DIR / "skills"
CONFIG_FILE = BASE_DIR / ".yips_config.json"

# Application info
APP_NAME = "Yips"

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


def load_config() -> YipsConfig:
    """Load saved configuration from file."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_config(config: YipsConfig) -> None:
    """Save configuration to file."""
    try:
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
    except OSError:
        pass
