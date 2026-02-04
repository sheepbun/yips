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
LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "http://127.0.0.1:8080")

class LlamaCppConnectionManager:
    """Manages the lifecycle and connection to the llama-server."""
    
    _server_process = None
    _last_model_path = None

    @classmethod
    def is_running(cls) -> bool:
        """Check if llama-server is responding."""
        try:
            response = requests.get(f"{LLAMA_SERVER_URL}/health", timeout=0.5)
            return response.status_code == 200
        except requests.RequestException:
            return False

    @classmethod
    def get_connection(cls, model_path: str | None = None) -> bool:
        """Ensure llama-server is running and return readiness status."""
        if cls.is_running():
            # If it's already running with the same model, we're good
            if model_path == cls._last_model_path or model_path is None:
                return True
            # Otherwise, we might need to restart with the new model (handled by caller if needed)

        # Ensure any stray processes are killed before starting
        cls.stop_server()

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
        # -ngl 10: offload even fewer layers to GPU to fit 20B model and its context
        # -c 16384: context size
        # --port 8080
        cmd = [
            LLAMA_SERVER_PATH,
            "-m", model_path,
            "-ngl", "10",
            "-c", "16384",
            "--port", "8080",
            "--embedding", # Enable embeddings for tools if needed
        ]

        # Ensure LD_LIBRARY_PATH includes the bin directory for shared libs
        env = os.environ.copy()
        bin_dir = str(Path(LLAMA_SERVER_PATH).parent)
        current_ld = env.get("LD_LIBRARY_PATH", "")
        if bin_dir not in current_ld:
            env["LD_LIBRARY_PATH"] = f"{bin_dir}:{current_ld}" if current_ld else bin_dir

        # Log to .yips/logs/llama_server.log
        from cli.config import DOT_YIPS_DIR
        log_dir = DOT_YIPS_DIR / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "llama_server.log"
        
        log_file = open(log_path, "a")
        log_file.write(f"\n--- Starting llama-server at {time.ctime()} ---\n")
        log_file.write(f"Command: {' '.join(cmd)}\n")
        log_file.flush()

        cls._server_process = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=log_file,
            start_new_session=True,
            env=env
        )
        cls._last_model_path = model_path

        # Wait for server to be ready
        for _ in range(120):
            time.sleep(1)
            if cls.is_running():
                return True
        
        return False

    @classmethod
    def stop_server(cls) -> bool:
        """Stop llama-server if it's running."""
        # Check if we should keep it running
        if os.environ.get("YIPS_PERSIST_BACKEND") == "1":
            return True

        # Try to find and kill llama-server processes
        try:
            subprocess.run(["pkill", "-f", "llama-server"], check=False)
            cls._server_process = None
            return True
        except Exception:
            return False

# Legacy function aliases for compatibility
def is_llamacpp_running() -> bool:
    return LlamaCppConnectionManager.is_running()

def start_llamacpp(model_path: str | None = None) -> bool:
    return LlamaCppConnectionManager.get_connection(model_path)

def stop_llamacpp() -> bool:
    return LlamaCppConnectionManager.stop_server()

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
