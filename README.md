# Automatic Git Versioning

This repository uses automatic version numbering based on git commits.

- **Format**: vYYYY.M.D-SHORTHASH
- **Example**: v2026.1.31-134ae0f
- **Usage**: Run `python version.py` to see the current version

The version is calculated dynamically from the latest git commit, so it always stays in sync with the repository state.

## 🚀 Quick Start

Yips is designed to be zero-config. The included startup script handles dependency checks, virtual environments, and configuration automatically.

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/Yips.git
cd Yips
```

### 2. Run the startup script
```bash
./startup.sh
```

The script will:
*   Verify Python 3 installation.
*   Create a virtual environment (`.venv`) if missing.
*   Install/Update all dependencies from `requirements.txt`.
*   Check for `llama.cpp` (the preferred backend).
*   Initialize your `.yips_config.json` on the first run.
*   Launch the Yips CLI.

## 🛠 Backends

Yips supports multiple backends for maximum flexibility:
1.  **llama.cpp** (Local, High Performance) - *Recommended*
2.  **LM Studio** (Local, GUI-based)
3.  **Claude CLI** (Cloud-based fallback)

Use the `/backend` command within Yips to switch between them.

## 🧠 Model Management

Yips features a hardware-aware model recommendation engine. Run:
```bash
/models
```
within the CLI to see popular Hugging Face models filtered by your system's detected RAM and VRAM.
