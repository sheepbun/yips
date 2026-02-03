"""
LM Studio process management for Yips CLI.

Handles LM Studio API connectivity, process management, and model discovery.
"""

import os
import subprocess
import time
from pathlib import Path

import requests

# LM Studio configuration
LM_STUDIO_URL = os.environ.get("LM_STUDIO_URL", "http://localhost:1234")
LM_STUDIO_MODELS_DIR = Path.home() / ".lmstudio" / "models"
LM_STUDIO_MODEL = os.environ.get("LM_STUDIO_MODEL", "qwen/qwen3-4b-thinking-2507")
LMS_CLI_PATH = os.environ.get("LMS_CLI_PATH", "/home/katherine/.lmstudio/bin/lms")
LM_STUDIO_APPIMAGE = os.environ.get("LM_STUDIO_APPIMAGE", "/home/katherine/Apps/LM-Studio.AppImage")

# Read LM Studio API key from installation
def _get_lm_studio_auth() -> str:
    """Helper to retrieve LM Studio API key from file or environment."""
    try:
        lms_key_file = Path.home() / ".lmstudio" / ".internal" / "lms-key-2"
        if lms_key_file.exists():
            return lms_key_file.read_text().strip()
    except Exception:
        pass
    return os.environ.get("LM_STUDIO_AUTH", "")


LM_STUDIO_AUTH = _get_lm_studio_auth()

# Claude CLI configuration (fallback)
CLAUDE_CLI_PATH = os.environ.get("CLAUDE_CLI_PATH", "/home/katherine/.local/bin/claude")
CLAUDE_CLI_MODEL = os.environ.get("CLAUDE_CLI_MODEL", "sonnet")


def is_lmstudio_running() -> bool:
    """Check if LM Studio API is responding."""
    try:
        response = requests.get(f"{LM_STUDIO_URL}/v1/models", timeout=0.5)
        return response.status_code == 200
    except requests.RequestException:
        return False


def ensure_lmstudio_running() -> bool:
    """Start LM Studio headless server if not running and wait for it to be ready."""
    if is_lmstudio_running():
        return True

    # Check if AppImage daemon is running
    try:
        daemon_running = subprocess.run(
            ["pgrep", "-f", "LM-Studio.AppImage"],
            capture_output=True
        ).returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        daemon_running = False

    # Start AppImage daemon if not running (required for lms CLI to work)
    if not daemon_running and os.path.exists(LM_STUDIO_APPIMAGE):
        subprocess.Popen(
            [LM_STUDIO_APPIMAGE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        # Wait for daemon to initialize
        time.sleep(8)

    # Start headless server via lms CLI
    try:
        subprocess.run(
            [LMS_CLI_PATH, "server", "start"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False

    # Wait for API to become available (up to 30 seconds)
    for _ in range(30):
        time.sleep(1)
        if is_lmstudio_running():
            return True

    return False


def unload_all_models() -> bool:
    """Unload all models from LM Studio using the CLI."""
    try:
        subprocess.run(
            [LMS_CLI_PATH, "unload", "--all"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10
        )
        return True
    except Exception:
        return False


def get_available_models() -> list[str]:
    """Scan LM Studio for available models using the CLI."""
    try:
        result = subprocess.run(
            [LMS_CLI_PATH, "ls", "--json", "--llm"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            import json
            models_data = json.loads(result.stdout)
            # Use 'path' as the identifier as it's what 'lms load' and the API usually expect
            return sorted([m["path"] for m in models_data if "path" in m])
    except Exception:
        pass

    # Fallback to directory scanning if CLI fails
    models: list[str] = []
    if LM_STUDIO_MODELS_DIR.is_dir():
        for gguf in LM_STUDIO_MODELS_DIR.rglob("*.gguf"):
            try:
                # Get path relative to models directory
                model_path = gguf.parent.relative_to(LM_STUDIO_MODELS_DIR)
                # Use parent directory name as model identifier, but skip "."
                path_str = str(model_path)
                if path_str != ".":
                    models.append(path_str)
            except (ValueError, RuntimeError):
                continue
    return sorted(list(set(models)))
