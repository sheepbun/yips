"""
Setup utilities for Yips CLI dependencies.
"""

import os
import shutil
import subprocess
import requests
from typing import List
from pathlib import Path
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, DownloadColumn, TransferSpeedColumn
from cli.color_utils import console
from cli.llamacpp import LLAMA_MODELS_DIR, LLAMA_DEFAULT_MODEL, get_llama_server_candidates
from cli.hw_utils import detect_cuda_toolkit


def detect_llama_build_mode(install_dir: Path | None = None) -> str:
    """Detect whether the existing llama.cpp build is CUDA-enabled or CPU-only."""
    if install_dir is None:
        install_dir = Path.home() / "llama.cpp"

    cache_path = install_dir / "build" / "CMakeCache.txt"
    if cache_path.exists():
        try:
            cache = cache_path.read_text()
        except OSError:
            cache = ""
        if "GGML_CUDA:BOOL=ON" in cache:
            return "cuda"
        if "GGML_CUDA:BOOL=OFF" in cache:
            return "cpu"

    binary_candidates = [
        Path(candidate) for candidate in get_llama_server_candidates()
        if Path(candidate).exists()
    ]
    for candidate in binary_candidates:
        try:
            output = subprocess.check_output(
                [str(candidate), "--version"],
                text=True,
                stderr=subprocess.STDOUT,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            continue
        lowered = output.lower()
        if "cuda" in lowered or "cublas" in lowered:
            return "cuda"

    return "unknown"


def get_llama_cmake_args(cuda_enabled: bool, cuda_toolkit_root: str | None = None) -> list[str]:
    """Return the cmake configuration arguments for llama.cpp."""
    args = ["-DLLAMA_BUILD_SERVER=ON"]
    args.append(f"-DGGML_CUDA={'ON' if cuda_enabled else 'OFF'}")
    if cuda_enabled and cuda_toolkit_root:
        args.append(f"-DCUDAToolkit_ROOT={cuda_toolkit_root}")
    return args

def check_build_tools() -> bool:
    """Check if git, cmake, and compiler are available."""
    missing: List[str] = []
    if not shutil.which("git"):
        missing.append("git")
    if not shutil.which("cmake"):
        missing.append("cmake")
    if not shutil.which("g++") and not shutil.which("clang++"):
        missing.append("g++ or clang++")
    
    if missing:
        console.print(f"[red]Missing build tools: {', '.join(missing)}[/red]")
        console.print("Please install them using your package manager (e.g., `sudo apt install git build-essential`).")
        return False
    return True

def install_llama_server() -> str | None:
    """
    Downloads and builds llama.cpp.
    Returns the path to the built binary, or None if failed.
    """
    if not check_build_tools():
        return None

    install_dir = Path.home() / "llama.cpp"
    cuda_support = detect_cuda_toolkit()
    prefer_cuda = cuda_support["available"]
    existing_mode = detect_llama_build_mode(install_dir) if install_dir.exists() else "unknown"
    
    if install_dir.exists():
        console.print(f"[yellow]Directory {install_dir} already exists. Updating...[/yellow]")
        try:
            subprocess.run(["git", "pull"], cwd=install_dir, check=True, capture_output=True)
        except subprocess.CalledProcessError:
            console.print("[red]Failed to update llama.cpp repo. Continuing with existing version...[/red]")
    else:
        console.print(f"[cyan]Cloning llama.cpp to {install_dir}...[/cyan]")
        try:
            subprocess.run(
                ["git", "clone", "https://github.com/ggerganov/llama.cpp", str(install_dir)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
        except subprocess.CalledProcessError as e:
            console.print(f"[red]Failed to clone llama.cpp: {e}[/red]")
            return None

    if prefer_cuda:
        console.print(f"[cyan]CUDA detected ({cuda_support['reason']}). Building llama.cpp with CUDA support...[/cyan]")
    elif existing_mode == "cuda":
        console.print("[yellow]CUDA is not currently available. Reconfiguring llama.cpp for CPU-only use...[/yellow]")
    else:
        console.print(f"[cyan]Building llama.cpp without CUDA ({cuda_support['reason']})...[/cyan]")

    jobs = str(max(1, (os.cpu_count() or 4)))
    cmake_config = [
        "cmake", "-S", str(install_dir), "-B", str(install_dir / "build"),
        *get_llama_cmake_args(prefer_cuda, cuda_support.get("toolkit_root")),
    ]
    cmake_build = [
        "cmake", "--build", str(install_dir / "build"), "--config", "Release", "-j", jobs, "--target", "llama-server",
    ]
    env = os.environ.copy()
    nvcc_path = cuda_support.get("nvcc_path")
    toolkit_root = cuda_support.get("toolkit_root")
    if nvcc_path and toolkit_root:
        env["PATH"] = f"{Path(nvcc_path).parent}:{env.get('PATH', '')}"
        env["CUDAToolkit_ROOT"] = toolkit_root

    try:
        with console.status("[bold green]Compiling...[/bold green]"):
            subprocess.run(
                cmake_config,
                cwd=install_dir,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            subprocess.run(
                cmake_build,
                cwd=install_dir,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Build failed: {e.stderr.decode()}[/red]")
        return None

    for candidate in get_llama_server_candidates():
        if Path(candidate).exists():
            final_mode = detect_llama_build_mode(install_dir)
            console.print(f"[green]Successfully built llama-server at {candidate} ({final_mode}).[/green]")
            return candidate

    console.print("[red]Build completed but binary not found.[/red]")
    return None

def download_default_model() -> str | None:
    """
    Downloads the default model if missing.
    """
    # LLAMA_DEFAULT_MODEL might be "author/repo/file.gguf"
    # We want to construct a download URL.
    # Assuming HuggingFace format for now.
    
    model_path = LLAMA_MODELS_DIR / LLAMA_DEFAULT_MODEL
    if model_path.exists():
        return str(model_path)

    # Construct URL (This is a heuristic, might need adjustment based on specific model string)
    # Model string: lmstudio-community/Qwen3-4B-Thinking-2507-GGUF/Qwen3-4B-Thinking-2507-Q4_K_M.gguf
    parts = LLAMA_DEFAULT_MODEL.split('/')
    if len(parts) >= 3:
        repo_id = f"{parts[0]}/{parts[1]}"
        filename = parts[-1]
        url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
    else:
        console.print(f"[red]Could not parse model path for auto-download: {LLAMA_DEFAULT_MODEL}[/red]")
        return None

    console.print(f"[cyan]Downloading model to {model_path}...[/cyan]")
    model_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            console=console
        ) as progress:
            task = progress.add_task(f"Downloading {filename}", total=total_size)
            
            with open(model_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    progress.update(task, advance=len(chunk))
                    
        console.print("[green]Model download complete.[/green]")
        return str(model_path)

    except Exception as e:
        console.print(f"[red]Download failed: {e}[/red]")
        if model_path.exists():
            model_path.unlink() # Delete partial file
        return None
