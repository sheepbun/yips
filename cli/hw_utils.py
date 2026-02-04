"""
Hardware detection utilities for Yips.
"""

import os
import psutil
import subprocess

def get_system_specs():
    """Detect RAM and VRAM for model suitability checks."""
    specs = {
        "ram_gb": 0,
        "vram_gb": 0,
        "gpu_type": None
    }
    
    # RAM
    ram = psutil.virtual_memory()
    specs["ram_gb"] = round(ram.total / (1024**3), 1)
    
    # VRAM (NVIDIA)
    try:
        nvidia_smi = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"], text=True)
        vram_values = [int(x) for x in nvidia_smi.strip().split('\n')]
        specs["vram_gb"] = round(sum(vram_values) / 1024, 1)
        specs["gpu_type"] = "nvidia"
    except (subprocess.SubprocessError, FileNotFoundError):
        # Check for AMD (rocm-smi)
        try:
            amd_smi = subprocess.check_output(["rocm-smi", "--showmeminfo", "vram", "--json"], text=True)
            # Simplified parsing
            specs["gpu_type"] = "amd"
        except (subprocess.SubprocessError, FileNotFoundError):
            pass
            
    return specs

def is_model_suitable(specs, model_size_gb):
    """Check if a model fits in VRAM or RAM."""
    # Rough heuristic for GGUF: fits in VRAM if size < 80% of VRAM
    # Fits in RAM if size < 70% of total RAM
    if specs["vram_gb"] > 0:
        if model_size_gb < (specs["vram_gb"] * 0.8):
            return "vram"
    if model_size_gb < (specs["ram_gb"] * 0.7):
        return "ram"
    return None
