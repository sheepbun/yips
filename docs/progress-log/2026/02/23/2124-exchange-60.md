## 2026-02-23 21:24 MST — Exchange 60

Summary: Fixed Arch installer CUDA fallback failure by preventing stale CMake CUDA cache from poisoning CPU fallback; added nvcc gate for CUDA attempts.
Changed:

- Updated `install.sh` CPU fallback path:
  - clears `${LLAMA_BUILD_DIR}/CMakeCache.txt` and `${LLAMA_BUILD_DIR}/CMakeFiles` before reconfigure
  - explicitly configures CPU build with `-DGGML_CUDA=OFF`
- Updated CUDA decision logic:
  - if NVIDIA GPU is present but `nvcc` is missing, installer now skips CUDA attempt and goes straight to CPU build with a warning
- Verified script syntax with `bash -n install.sh`.
  Validation:
- `bash -n install.sh` — clean
  Next:
- Optionally add an explicit Arch CUDA prerequisite hint (e.g. `cuda` package) when `nvidia-smi` is present but `nvcc` is absent.
