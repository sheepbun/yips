"""
llama.cpp process management for Yips CLI.

Handles starting and stopping the llama-server and checking its status.
"""

import os
import socket
import subprocess
import tempfile
import time
import requests
import shutil
from pathlib import Path
from cli.color_utils import console
from cli.hw_utils import get_system_specs

# llama.cpp configuration
def get_llama_server_candidates() -> list[str]:
    """Return supported llama-server locations in priority order."""
    candidates: list[str] = []

    env_path = os.environ.get("LLAMA_SERVER_PATH")
    if env_path:
        candidates.append(env_path)

    home = Path.home() / "llama.cpp"
    candidates.extend([
        str(home / "build" / "bin" / "llama-server"),
        str(home / "bin" / "llama-server"),
        str(home / "llama-server"),
    ])

    which_path = shutil.which("llama-server")
    if which_path:
        candidates.append(which_path)

    # Preserve order while removing duplicates.
    return list(dict.fromkeys(candidates))


def _resolve_llama_server_path() -> str:
    """Resolve the path to the llama-server binary."""
    candidates = get_llama_server_candidates()
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    # Fallback to the preferred CMake build location.
    return str(Path.home() / "llama.cpp" / "build" / "bin" / "llama-server")

LLAMA_SERVER_PATH = _resolve_llama_server_path()
LLAMA_MODELS_DIR = Path.home() / ".lmstudio" / "models"

LLAMA_DEFAULT_MODEL = "lmstudio-community/Qwen3-4B-Thinking-2507-GGUF/Qwen3-4B-Thinking-2507-Q4_K_M.gguf"
LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "http://127.0.0.1:8080")

_server_process: subprocess.Popen[bytes] | None = None
_current_model_path: str | None = None
_current_strategy: str | None = None
_last_server_error = ""


def get_llama_server_url() -> str:
    """Return the active llama.cpp server URL."""
    return LLAMA_SERVER_URL


def get_last_llama_server_error() -> str:
    """Return the last captured llama.cpp startup error."""
    return _last_server_error


def _set_llama_server_url(port: int) -> None:
    """Update the active llama.cpp server URL."""
    global LLAMA_SERVER_URL
    LLAMA_SERVER_URL = f"http://127.0.0.1:{port}"


def _get_llama_server_port() -> int:
    """Extract the configured server port from the current URL."""
    return int(LLAMA_SERVER_URL.rsplit(":", 1)[-1])


def _is_port_available(port: int) -> bool:
    """Return True when a localhost TCP port can be bound."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
    except OSError:
        return False
    return True


def _find_available_port() -> int:
    """Ask the OS for a free localhost TCP port."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])
    except OSError:
        return _get_llama_server_port()

def is_llamacpp_running() -> bool:
    """Check if llama-server is responding."""
    try:
        response = requests.get(f"{LLAMA_SERVER_URL}/health", timeout=2.0)
        return response.status_code == 200
    except requests.RequestException:
        return False

def get_optimal_context_size() -> int:
    """Calculate optimal context size based on available system memory (RAM + VRAM)."""
    specs = get_system_specs()
    total_mem_gb = specs["ram_gb"] + specs["vram_gb"]
    
    # Heuristic: 512 tokens per GB of total memory
    # e.g., 16GB -> 8192, 32GB -> 16384, 64GB -> 32768
    raw_ctx = int(total_mem_gb * 512)
    
    # Round down to nearest 1024
    ctx = (raw_ctx // 1024) * 1024
    
    # Enforce minimum of 2048
    return max(2048, ctx)

def start_llamacpp(model_path: str | None = None) -> bool:
    """Start llama-server with the specified model, using fallbacks if necessary."""
    global _server_process, _current_model_path, _current_strategy, _last_server_error
    _last_server_error = ""

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
            if model_path and model_path in str(gguf):
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

    port = _get_llama_server_port()
    if not _is_port_available(port):
        fallback_port = _find_available_port()
        if fallback_port != port:
            console.print(f"[yellow]Port {port} is unavailable. Using port {fallback_port} for llama.cpp.[/yellow]")
            _set_llama_server_url(fallback_port)
            port = fallback_port

    # Define strategies: (name, list_of_flags)
    # We request 999 layers to force max GPU offload. 
    # llama.cpp will automatically fallback to CPU/RAM for layers that don't fit.
    strategies: list[tuple[str, list[str]]] = [
        ("GPU (Auto-Offload)", ["-ngl", "999"]),
        ("Hybrid (Default)", []),
        ("CPU Only", ["-ngl", "0"]),
    ]

    ctx_size = get_optimal_context_size()
    # console.print(f"[dim]Calculated optimal context size: {ctx_size} tokens[/dim]")

    for strategy_name, flags in strategies:
        # Start llama-server
        cmd = [
            LLAMA_SERVER_PATH,
            "-m", resolved_path,
            "-c", str(ctx_size),
            "--port", str(port),
            "--embedding", # Enable embeddings for tools if needed
            "--log-disable"
        ] + flags

        error_log = tempfile.NamedTemporaryFile(prefix="yips-llama-", suffix=".log", delete=False)
        error_log_path = error_log.name
        error_log.close()

        _server_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=open(error_log_path, "wb"),
            start_new_session=True
        )

        # Wait for server to be ready
        start_time = time.time()
        while time.time() - start_time < 60:
            if _server_process.poll() is not None:
                try:
                    _last_server_error = Path(error_log_path).read_text().strip()
                except OSError:
                    _last_server_error = ""
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
