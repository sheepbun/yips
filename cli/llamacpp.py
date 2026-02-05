"""
llama.cpp process management for Yips CLI.

Handles starting and stopping the llama-server and checking its status.
"""

import os
import subprocess
import time
import requests
import shutil
from pathlib import Path
from cli.color_utils import console

# llama.cpp configuration
def _resolve_llama_server_path() -> str:
    """Resolve the path to the llama-server binary."""
    # 1. Trust Env var if set
    env_path = os.environ.get("LLAMA_SERVER_PATH")
    if env_path:
        return env_path
    
    # 2. Check default build location
    default_build = Path.home() / "llama.cpp" / "build" / "bin" / "llama-server"
    if default_build.exists():
        return str(default_build)

    # 3. Check system PATH
    which_path = shutil.which("llama-server")
    if which_path:
        return which_path
        
    # 4. Fallback to default build location
    return str(default_build)

LLAMA_SERVER_PATH = _resolve_llama_server_path()
LLAMA_MODELS_DIR = Path.home() / ".lmstudio" / "models"

LLAMA_DEFAULT_MODEL = "lmstudio-community/Qwen3-4B-Thinking-2507-GGUF/Qwen3-4B-Thinking-2507-Q4_K_M.gguf"
LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "http://localhost:8080")

_server_process = None
_current_model_path = None
_current_strategy = None

def is_llamacpp_running() -> bool:
    """Check if llama-server is responding."""
    try:
        response = requests.get(f"{LLAMA_SERVER_URL}/health", timeout=2.0)
        return response.status_code == 200
    except requests.RequestException:
        return False

def start_llamacpp(model_path: str | None = None) -> bool:
    """Start llama-server with the specified model, using fallbacks if necessary."""
    global _server_process, _current_model_path, _current_strategy

    # Resolve model path first
    if not model_path:
        resolved_path = str(LLAMA_MODELS_DIR / LLAMA_DEFAULT_MODEL)
    elif not os.path.isabs(model_path):
        resolved_path = str(LLAMA_MODELS_DIR / model_path)
    else:
        resolved_path = model_path

    if not os.path.exists(resolved_path):
        # Fallback to searching for the model
        found = False
        for gguf in LLAMA_MODELS_DIR.rglob("*.gguf"):
            if model_path in str(gguf):
                resolved_path = str(gguf)
                found = True
                break
        if not found:
            return False

    # Check if we need to restart
    if is_llamacpp_running():
        # Check 1: Is it the same model?
        if _current_model_path == resolved_path:
            # Check 2: Optimization - if it fits in VRAM (10GB) but is on CPU, restart to try GPU
            try:
                size_bytes = os.path.getsize(resolved_path)
                limit_bytes = 10 * 1024 * 1024 * 1024 # 10 GB
                
                if size_bytes < limit_bytes and _current_strategy == "CPU Only":
                    console.print(f"[yellow]Model fits in VRAM ({size_bytes/1024**3:.2f} GB) but is running on CPU. Restarting on GPU...[/yellow]")
                    stop_llamacpp()
                else:
                    return True # Running and optimal
            except OSError:
                return True # Can't check size, assume fine
        else:
            # Different model, must restart
            stop_llamacpp()

    if not os.path.exists(LLAMA_SERVER_PATH):
        return False

    # Force cleanup of any potential zombie processes before starting
    stop_llamacpp()

    # Define strategies: (name, list_of_flags)
    # We request 999 layers to force max GPU offload. 
    # llama.cpp will automatically fallback to CPU/RAM for layers that don't fit.
    strategies = [
        ("GPU (Auto-Offload)", ["-ngl", "999"]),
        ("Hybrid (Default)", []),
        ("CPU Only", ["-ngl", "0"]),
    ]

    for strategy_name, flags in strategies:
        # Start llama-server
        cmd = [
            LLAMA_SERVER_PATH,
            "-m", resolved_path,
            "-c", "8192",
            "--port", "8080",
            "--embedding", # Enable embeddings for tools if needed
            "--log-disable"
        ] + flags

        _server_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )

        # Wait for server to be ready
        start_time = time.time()
        while time.time() - start_time < 60:
            if _server_process.poll() is not None:
                break
            
            if is_llamacpp_running():
                _current_model_path = resolved_path
                _current_strategy = strategy_name
                return True
            
            time.sleep(1)
        
        stop_llamacpp()
    
    return False

def stop_llamacpp() -> bool:
    """Stop llama-server if it's running."""
    global _server_process, _current_model_path, _current_strategy

    # Method 1: Stop the process we started
    if _server_process:
        try:
            _server_process.terminate()
            try:
                _server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _server_process.kill()
                _server_process.wait(timeout=2)
        except Exception:
            pass
        _server_process = None
        _current_model_path = None
        _current_strategy = None

    # Method 2: Cleanup any orphaned processes (try graceful first)
    try:
        subprocess.run(["pkill", "-f", "llama-server"], check=False)
    except Exception:
        pass

    # Wait for the server to actually stop responding
    for _ in range(10): 
        if not is_llamacpp_running():
            return True
        time.sleep(0.5)

    # Method 3: Aggressive cleanup (SIGKILL)
    try:
        subprocess.run(["pkill", "-9", "-f", "llama-server"], check=False)
    except Exception:
        pass
    
    time.sleep(1) # Give OS a moment to reclaim VRAM
    return not is_llamacpp_running()

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