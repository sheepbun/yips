"""
Hardware detection utilities for Yips.
"""

import os
import shutil
import sys
import psutil
import subprocess
from typing import TypedDict


class SystemSpecs(TypedDict):
    ram_gb: float
    vram_gb: float
    gpu_type: str | None


class CudaSupport(TypedDict):
    available: bool
    reason: str
    toolkit_root: str | None
    nvcc_path: str | None


def get_system_specs() -> SystemSpecs:
    """Detect RAM and VRAM for model suitability checks."""
    specs: SystemSpecs = {
        "ram_gb": 0.0,
        "vram_gb": 0.0,
        "gpu_type": None
    }
    
    # RAM
    ram = psutil.virtual_memory()
    specs["ram_gb"] = round(float(ram.total) / (1024**3), 1)
    
    # VRAM (NVIDIA)
    try:
        nvidia_smi = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"], text=True)
        vram_values = [int(x) for x in nvidia_smi.strip().split('\n')]
        specs["vram_gb"] = round(float(sum(vram_values)) / 1024, 1)
        specs["gpu_type"] = "nvidia"
    except (subprocess.SubprocessError, FileNotFoundError):
        # Check for AMD (rocm-smi)
        try:
            # We don't parse json yet, but we mark it as AMD if the command exists
            subprocess.check_output(["rocm-smi", "--showmeminfo", "vram"], text=True)
            specs["gpu_type"] = "amd"
        except (subprocess.SubprocessError, FileNotFoundError):
            pass
            
    return specs


def _get_driver_max_cuda_version() -> tuple[int, int] | None:
    """Return the max CUDA version the installed GPU driver supports as (major, minor), or None."""
    try:
        output = subprocess.check_output(
            ["nvidia-smi"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        # nvidia-smi header contains "CUDA Version: X.Y"
        import re
        match = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", output)
        if match:
            return int(match.group(1)), int(match.group(2))
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return None


def _get_nvcc_version(nvcc_path: str) -> tuple[int, int] | None:
    """Return the CUDA version for a given nvcc binary as (major, minor), or None."""
    try:
        output = subprocess.check_output(
            [nvcc_path, "--version"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        import re
        match = re.search(r"release (\d+)\.(\d+)", output)
        if match:
            return int(match.group(1)), int(match.group(2))
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return None


def has_nvidia_gpu() -> bool:
    """True if nvidia-smi reports at least one NVIDIA GPU."""
    if not shutil.which("nvidia-smi"):
        return False
    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return bool(output)


def detect_cuda_toolkit() -> CudaSupport:
    """Detect a CUDA toolkit compatible with the installed GPU driver.

    Prefers the highest compatible toolkit version. If the nvcc on PATH is
    newer than the driver supports, scans installed CUDA directories for a
    compatible version instead.
    """
    import glob

    driver_max = _get_driver_max_cuda_version()

    # Build list of candidate nvcc paths: PATH first, then installed dirs
    candidates: list[str] = []
    path_nvcc = shutil.which("nvcc")
    if path_nvcc:
        candidates.append(path_nvcc)

    if sys.platform == 'win32':
        win_cuda_base = r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"
        # Sort descending so highest version is tried first
        cuda_roots = sorted(glob.glob(win_cuda_base + r"\v*"), reverse=True)
    else:
        cuda_roots = ["/usr/local/cuda", "/opt/cuda"]
    nvcc_exe = "nvcc.exe" if sys.platform == "win32" else "nvcc"
    for root in cuda_roots:
        candidate_nvcc = os.path.join(root, "bin", nvcc_exe)
        if os.path.isfile(candidate_nvcc) and candidate_nvcc not in candidates:
            candidates.append(candidate_nvcc)

    best: CudaSupport | None = None
    incompatible_reason = ""

    for nvcc in candidates:
        if not os.path.isfile(nvcc):
            continue
        toolkit_root = os.path.dirname(os.path.dirname(nvcc))
        ver = _get_nvcc_version(nvcc)

        if driver_max is None or ver is None:
            # Cannot compare versions — accept the first one we find
            return {
                "available": True,
                "reason": f"nvcc detected at {nvcc}",
                "toolkit_root": toolkit_root,
                "nvcc_path": nvcc,
            }

        if ver <= driver_max:
            # Compatible — use it (first match is highest version due to sort order)
            return {
                "available": True,
                "reason": f"CUDA {ver[0]}.{ver[1]} toolkit compatible with driver (max CUDA {driver_max[0]}.{driver_max[1]})",
                "toolkit_root": toolkit_root,
                "nvcc_path": nvcc,
            }
        else:
            if not incompatible_reason:
                incompatible_reason = (
                    f"CUDA toolkit {ver[0]}.{ver[1]} is newer than the GPU driver supports "
                    f"(driver max: CUDA {driver_max[0]}.{driver_max[1]})"
                )

    if incompatible_reason:
        return {"available": False, "reason": incompatible_reason, "toolkit_root": None, "nvcc_path": None}

    return {"available": False, "reason": "CUDA toolkit not found", "toolkit_root": None, "nvcc_path": None}


def detect_cuda_support() -> CudaSupport:
    """Detect whether the local environment can run a CUDA llama.cpp binary."""
    if not shutil.which("nvidia-smi"):
        return {"available": False, "reason": "nvidia-smi not found", "toolkit_root": None, "nvcc_path": None}

    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        return {"available": False, "reason": "nvidia-smi query failed", "toolkit_root": None, "nvcc_path": None}

    if not output:
        return {"available": False, "reason": "no NVIDIA GPUs detected", "toolkit_root": None, "nvcc_path": None}

    toolkit = detect_cuda_toolkit()
    if toolkit["available"]:
        return {
            "available": True,
            "reason": toolkit["reason"],
            "toolkit_root": toolkit["toolkit_root"],
            "nvcc_path": toolkit["nvcc_path"],
        }

    # Runtime CUDA availability does not require nvcc. If the driver can
    # enumerate an NVIDIA GPU and llama.cpp is already built with CUDA, we
    # should still allow GPU execution.
    return {
        "available": True,
        "reason": "NVIDIA GPU detected via nvidia-smi",
        "toolkit_root": None,
        "nvcc_path": None,
    }

def is_model_suitable(specs: SystemSpecs, model_size_gb: float) -> str | None:
    """Check if a model fits in VRAM or RAM."""
    # Rough heuristic for GGUF: fits in VRAM if size < 80% of VRAM
    # Fits in RAM if size < 70% of total RAM
    if specs["vram_gb"] > 0:
        if model_size_gb < (specs["vram_gb"] * 0.8):
            return "vram"
    if model_size_gb < (specs["ram_gb"] * 0.7):
        return "ram"
    return None
