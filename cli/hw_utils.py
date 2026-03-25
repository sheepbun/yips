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


def detect_cuda_toolkit() -> CudaSupport:
    """Detect whether a CUDA toolkit is installed locally for building llama.cpp."""
    nvcc_path = shutil.which("nvcc")
    if nvcc_path:
        toolkit_root = os.path.dirname(os.path.dirname(nvcc_path))
        return {"available": True, "reason": "nvcc detected", "toolkit_root": toolkit_root, "nvcc_path": nvcc_path}

    if sys.platform == 'win32':
        import glob
        win_cuda_base = r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"
        cuda_roots = sorted(glob.glob(win_cuda_base + r"\v*"), reverse=True)
    else:
        cuda_roots = [
            "/usr/local/cuda",
            "/opt/cuda",
        ]
    for root in cuda_roots:
        candidate_nvcc = os.path.join(root, "bin", "nvcc")
        if os.path.isfile(candidate_nvcc):
            return {
                "available": True,
                "reason": f"nvcc detected at {candidate_nvcc}",
                "toolkit_root": root,
                "nvcc_path": candidate_nvcc,
            }

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
