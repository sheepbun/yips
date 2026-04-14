# Automatic Git Versioning

- **Format**: `vmajor.minor.patch` where each commit adds `+0.0.1`, patch rolls into minor after `v0.0.99 -> v0.1.00`, minor rolls into major after `v0.99.99 -> v1.0.00`.
- **Example**: 121 commits &rarr; `v0.1.21`
- **Usage**: Run `python version.py` to see the current version

The version is recalculated from the commit count so it always reflects the repository history.

## 🚀 Quick Start

Yips is designed to be zero-config. The included startup script handles dependency checks, virtual environments, and configuration automatically.

### 1. Clone the repository
```bash
git clone https://github.com/sheepbun/yips-cli.git
cd Yips
```

### 2. Run the startup script
```bash
chmod +x startup.sh
./startup.sh
```

The script will:
*   Verify Python 3 installation.
*   Create a virtual environment (`.venv`) if missing.
*   Install/Update all dependencies from `requirements.txt`.
*   Clone/update and build `llama.cpp` automatically, enabling CUDA when an NVIDIA CUDA environment is detected.
*   Initialize your `.yips_config.json` on the first run.
*   Launch the Yips CLI.

## 🛠 Backends

Yips supports multiple backends for maximum flexibility:
1.  **llama.cpp** (Local, High Performance) - *Recommended*
2.  **LM Studio** (Local, GUI-based)
3.  **Claude CLI** (Cloud-based fallback)

Use the `/backend` command within Yips to switch between them.

## 🧠 Model Management

Yips features a hardware-aware Model Manager. Run:
```bash
/model
```
within the CLI to manage your local models, switch between backends, or jump to the interactive downloader.

## Developer documentation

For persistence layout, how to add slash-command plugins, model tool tags, and setup/backend operations, see [docs/DEVELOPER.md](docs/DEVELOPER.md).
