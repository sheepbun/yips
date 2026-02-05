"""
Setup utilities for Yips CLI dependencies.
"""

import os
import shutil
import subprocess
import sys
import requests
from pathlib import Path
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, DownloadColumn, TransferSpeedColumn
from cli.color_utils import console
from cli.llamacpp import LLAMA_MODELS_DIR, LLAMA_DEFAULT_MODEL

def check_build_tools() -> bool:
    """Check if git, make, and compiler are available."""
    missing = []
    if not shutil.which("git"):
        missing.append("git")
    if not shutil.which("make"):
        missing.append("make")
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

    console.print("[cyan]Building llama.cpp (this may take a few minutes)...[/cyan]")
    try:
        # Run make in the installation directory
        with console.status("[bold green]Compiling...[/bold green]"):
            subprocess.run(
                ["make", "-j4", "llama-server"], # Build only the server to save time
                cwd=install_dir,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Build failed: {e.stderr.decode()}[/red]")
        return None

    # Verify binary exists
    binary_path = install_dir / "llama-server" # Old path
    if not binary_path.exists():
        binary_path = install_dir / "build" / "bin" / "llama-server" # CMake path
    
    if not binary_path.exists():
        # Fallback: just check for 'llama-server' in root (Makefile usually puts it there)
        binary_path = install_dir / "llama-server"

    if binary_path.exists():
        console.print(f"[green]Successfully built llama-server at {binary_path}[/green]")
        return str(binary_path)
    else:
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
