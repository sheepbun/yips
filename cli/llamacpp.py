"""
llama.cpp process management for Yips CLI.

Handles starting and stopping the llama-server and checking its status.
"""

import os
import subprocess
import time
import requests
from pathlib import Path

# llama.cpp configuration
LLAMA_SERVER_PATH = os.environ.get("LLAMA_SERVER_PATH", str(Path.home() / "llama.cpp" / "build" / "bin" / "llama-server"))
LLAMA_MODELS_DIR = Path.home() / ".lmstudio" / "models" # Reuse LM Studio models dir for now
LLAMA_DEFAULT_MODEL = "lmstudio-community/Qwen3-4B-Thinking-2507-GGUF/Qwen3-4B-Thinking-2507-Q4_K_M.gguf"
LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "http://localhost:8080")

_server_process = None

def is_llamacpp_running() -> bool:
    """Check if llama-server is responding."""
    try:
        response = requests.get(f"{LLAMA_SERVER_URL}/health", timeout=0.5)
        return response.status_code == 200
    except requests.RequestException:
        return False

def start_llamacpp(model_path: str | None = None) -> bool:
    """Start llama-server with the specified model."""
    if is_llamacpp_running():
        # TODO: Check if it's the right model?
        # For now, if it's running, we assume it's fine.
        return True

    if not model_path:
        model_path = str(LLAMA_MODELS_DIR / LLAMA_DEFAULT_MODEL)
    elif not os.path.isabs(model_path):
        model_path = str(LLAMA_MODELS_DIR / model_path)

    if not os.path.exists(model_path):
        # Fallback to searching for the model
        found = False
        for gguf in LLAMA_MODELS_DIR.rglob("*.gguf"):
            if model_path in str(gguf):
                model_path = str(gguf)
                found = True
                break
        if not found:
            return False

    if not os.path.exists(LLAMA_SERVER_PATH):
        return False

    # Start llama-server
    # -ngl 99: offload all layers to GPU
    # -c 4096: context size
    # --port 8080
    cmd = [
        LLAMA_SERVER_PATH,
        "-m", model_path,
        "-ngl", "99",
        "-c", "8192",
        "--port", "8080",
        "--embedding", # Enable embeddings for tools if needed
        "--log-disable"
    ]

    global _server_process
    _server_process = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )

    # Wait for server to be ready
    for _ in range(60):
        time.sleep(1)
        if is_llamacpp_running():
            return True
    
    return False

def stop_llamacpp() -> bool:
    """Stop llama-server if it's running."""
    # Try to find and kill llama-server processes
    try:
        subprocess.run(["pkill", "-f", "llama-server"], check=False)
        return True
    except Exception:
        return False

def get_available_models() -> list[str]:
    """Scan for available GGUF models."""
    models: list[str] = []
    if LLAMA_MODELS_DIR.is_dir():
        for gguf in LLAMA_MODELS_DIR.rglob("*.gguf"):
            try:
                # Get path relative to models directory
                model_path = gguf.relative_to(LLAMA_MODELS_DIR)
                models.append(str(model_path))
            except (ValueError, RuntimeError):
                continue
    return sorted(list(set(models)))
