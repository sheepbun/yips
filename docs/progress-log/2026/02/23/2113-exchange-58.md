## 2026-02-23 21:13 MST — Exchange 58

Summary: Added an automated `install.sh` for one-command local runtime setup (dependencies, llama.cpp build, env wiring, config normalization) with model-downloader guidance when no GGUF exists.
Changed:

- Added executable `install.sh` at repository root.
- Installer behavior:
  - detects OS/package manager (`apt`, `dnf`, `brew`) and auto-installs missing prerequisites (`git`, `cmake`, build tools, `node`, `npm`, `curl`)
  - clones or fast-forward updates `~/llama.cpp`
  - builds llama.cpp with CUDA-first attempt (when `nvidia-smi` available) and CPU fallback
  - validates `~/llama.cpp/build/bin/llama-server`
  - creates `~/.yips/models`
  - writes idempotent `~/.yips/env.sh` exports (`LLAMA_SERVER_PATH`, `YIPS_LLAMA_SERVER_PATH`, `YIPS_LLAMA_MODELS_DIR`)
  - runs `npm install` in repo root
  - creates or patches `.yips_config.json` to ensure lifecycle fields exist without overwriting existing user values
  - prints final next-step instructions and prompts users to use `/download` or `/model` if no local GGUF model exists
- Updated docs:
  - `docs/guides/getting-started.md` now includes automated install flow and `source ~/.yips/env.sh` step.
  - `docs/changelog.md` updated with installer entry.
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean
  Next:
- Add a focused installer smoke-check in CI (shell syntax + dry-run validation) once a non-destructive dry-run mode is introduced.
