"""
Setup utilities for Yips CLI dependencies.
"""

import os
import shutil
import subprocess
import sys
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

    # 1. Check the actual binary first (most reliable)
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
            lowered = output.lower()
            if "cuda" in lowered or "cublas" in lowered:
                return "cuda"
            # If we found a binary and it says it's NOT cuda, we can't be sure 
            # if others exist, so we keep checking candidates.
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            continue

    # 2. Fallback to CMake cache if no binary version could be checked
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
    # On Windows CMake auto-detects MSVC via the registry, so skip the
    # compiler check entirely — cl.exe is only on PATH inside a VS Developer
    # Prompt, but CMake finds it without that.
    if sys.platform != "win32":
        if not shutil.which("g++") and not shutil.which("clang++"):
            missing.append("g++ or clang++")
    
    if missing:
        console.print(f"[red]Missing build tools: {', '.join(missing)}[/red]")
        console.print("Please install them using your package manager (e.g., `sudo apt install git build-essential`).")
        return False
    return True

def _get_llama_release_tag(install_dir: Path) -> str | None:
    """Return the llama.cpp git tag (e.g. 'b8522') from the install directory."""
    try:
        tag = subprocess.check_output(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=install_dir,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return tag if tag else None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


def _download_prebuilt_llama_cuda(install_dir: Path, cuda_major: int) -> bool:
    """Download a pre-built Windows CUDA binary from the llama.cpp GitHub release.

    Picks the highest compatible CUDA major version available for the release.
    Returns True if successful.
    """
    if sys.platform != "win32":
        return False

    tag = _get_llama_release_tag(install_dir)
    if not tag:
        return False

    bin_dir = install_dir / "build" / "bin" / "Release"
    bin_dir.mkdir(parents=True, exist_ok=True)

    base_url = f"https://github.com/ggerganov/llama.cpp/releases/download/{tag}"

    # Try cuda_major, then fall back to lower versions
    for try_major in range(cuda_major, 10, -1):
        # GitHub releases use minor version in the name; try common suffixes
        for suffix in [f"cuda-{try_major}.4", f"cuda-{try_major}.2", f"cuda-{try_major}.0",
                       f"cuda-{try_major}.6", f"cuda-{try_major}.5"]:
            zip_name = f"llama-{tag}-bin-win-{suffix}-x64.zip"
            cudart_name = f"cudart-llama-bin-win-{suffix}-x64.zip"
            url = f"{base_url}/{zip_name}"
            try:
                import io
                import zipfile
                console.print(f"[cyan]Trying pre-built binary: {zip_name}...[/cyan]")
                r = requests.get(url, stream=True, timeout=10)
                if r.status_code == 404:
                    continue
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                data = b""
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    BarColumn(),
                    DownloadColumn(),
                    TransferSpeedColumn(),
                    console=console,
                ) as progress:
                    task = progress.add_task(f"Downloading {zip_name}", total=total or None)
                    for chunk in r.iter_content(chunk_size=65536):
                        data += chunk
                        progress.update(task, advance=len(chunk))
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for member in z.namelist():
                        fname = Path(member).name
                        if not fname:
                            continue
                        dest = bin_dir / fname
                        with z.open(member) as src, open(dest, "wb") as dst:
                            import shutil as _shutil
                            _shutil.copyfileobj(src, dst)

                # Also download the matching cudart DLLs (cublas, cudart)
                cudart_url = f"{base_url}/{cudart_name}"
                try:
                    rc = requests.get(cudart_url, stream=True, timeout=10)
                    if rc.status_code == 200:
                        cudart_data = b""
                        total_c = int(rc.headers.get("content-length", 0))
                        with Progress(
                            SpinnerColumn(),
                            TextColumn("[progress.description]{task.description}"),
                            BarColumn(),
                            DownloadColumn(),
                            TransferSpeedColumn(),
                            console=console,
                        ) as progress:
                            task = progress.add_task(f"Downloading {cudart_name}", total=total_c or None)
                            for chunk in rc.iter_content(chunk_size=65536):
                                cudart_data += chunk
                                progress.update(task, advance=len(chunk))
                        with zipfile.ZipFile(io.BytesIO(cudart_data)) as z:
                            for member in z.namelist():
                                fname = Path(member).name
                                if not fname:
                                    continue
                                dest = bin_dir / fname
                                with z.open(member) as src, open(dest, "wb") as dst:
                                    import shutil as _shutil
                                    _shutil.copyfileobj(src, dst)
                except Exception:
                    pass  # cudart download is best-effort

                console.print(f"[green]Pre-built CUDA {suffix} binary installed successfully.[/green]")
                return True
            except Exception as e:
                console.print(f"[dim]  {zip_name}: {e}[/dim]")
                continue

    return False


def install_llama_server() -> str | None:
    """
    Downloads and builds llama.cpp (or installs a compatible pre-built binary on Windows).
    Returns the path to the built binary, or None if failed.

    On Windows with an NVIDIA GPU, prefers downloading a pre-built CUDA binary that
    matches the driver's maximum supported CUDA version, avoiding cmake's tendency to
    always pick the latest CUDA toolkit from the registry regardless of driver support.
    """
    install_dir = Path.home() / "llama.cpp"
    cuda_support = detect_cuda_toolkit()
    prefer_cuda = cuda_support["available"]
    existing_mode = detect_llama_build_mode(install_dir) if install_dir.exists() else "unknown"

    # Clone/update the source repo so we know the tag and can build if needed
    if (install_dir / ".git").exists():
        console.print(f"[yellow]Directory {install_dir} is a git repo. Updating...[/yellow]")
        try:
            subprocess.run(["git", "pull"], cwd=install_dir, check=True, capture_output=True)
        except subprocess.CalledProcessError:
            console.print("[red]Failed to update llama.cpp repo. Continuing with existing version...[/red]")
    elif install_dir.exists():
        console.print(f"[yellow]Directory {install_dir} exists (not a git repo). Skipping update.[/yellow]")
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

    # On Windows with CUDA, try downloading a pre-built binary first.
    # cmake on Windows always picks the CUDA version registered in the registry
    # (typically the newest), which may be incompatible with the GPU driver.
    # Downloading the matching pre-built binary sidesteps this entirely.
    if sys.platform == "win32" and prefer_cuda and cuda_support.get("nvcc_path"):
        if existing_mode == "cuda":
            for candidate in get_llama_server_candidates():
                if Path(candidate).exists():
                    console.print(f"[green]llama-server already has CUDA support at {candidate}[/green]")
                    return candidate

        from cli.hw_utils import _get_nvcc_version
        nvcc_ver = _get_nvcc_version(cuda_support["nvcc_path"])
        if nvcc_ver:
            cuda_major = nvcc_ver[0]
            console.print(
                f"[cyan]NVIDIA GPU detected. Trying pre-built CUDA {cuda_major}.x binary "
                f"(avoids cmake registry issues)...[/cyan]"
            )
            if _download_prebuilt_llama_cuda(install_dir, cuda_major):
                for candidate in get_llama_server_candidates():
                    if Path(candidate).exists():
                        console.print(f"[green]llama-server installed at {candidate}[/green]")
                        return candidate

    if not check_build_tools():
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
        sep = ";" if sys.platform == "win32" else ":"
        env["PATH"] = f"{Path(nvcc_path).parent}{sep}{env.get('PATH', '')}"
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
