#!/bin/bash
# Yips Auto-Installer/Updater
# This script ensures all dependencies are installed and up to date.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
LOCAL_BIN_DIR="$HOME/.local/bin"
YIPS_COMMAND_PATH="$LOCAL_BIN_DIR/yips"
YIPS_LAUNCHER_PATH="$PROJECT_ROOT/yips-launcher.sh"
LLAMA_DIR="$HOME/llama.cpp"
LLAMA_COMMAND_PATH="$LOCAL_BIN_DIR/llama-server"

# Function to print status
status() {
    echo -e "${GREEN}==>${NC} $1"
}

# Function to print warning
warning() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

# Function to print error and exit
error() {
    echo -e "${RED}Error:${NC} $1"
    exit 1
}

default_llama_model() {
    "$PROJECT_ROOT/.venv/bin/python" - <<'PY'
from cli.llamacpp import LLAMA_DEFAULT_MODEL
print(LLAMA_DEFAULT_MODEL)
PY
}

command_exists() {
    command -v "$1" &> /dev/null
}

llama_server_path() {
    local candidates=(
        "$LLAMA_DIR/build/bin/llama-server"
        "$LLAMA_DIR/bin/llama-server"
        "$LLAMA_DIR/llama-server"
    )
    local candidate
    for candidate in "${candidates[@]}"; do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

install_llama_server_link() {
    local binary_path="$1"
    mkdir -p "$LOCAL_BIN_DIR"
    if ln -sfn "$binary_path" "$LLAMA_COMMAND_PATH"; then
        status "Installed llama-server launcher: $LLAMA_COMMAND_PATH -> $binary_path"
    else
        warning "Could not install $LLAMA_COMMAND_PATH automatically."
    fi
}

build_llama_cpp() {
    local jobs
    jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

    if command_exists cmake; then
        status "Building llama.cpp with CMake..."
        if cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" -DLLAMA_BUILD_SERVER=ON \
            && cmake --build "$LLAMA_DIR/build" --config Release -j "$jobs" --target llama-server; then
            return 0
        fi
        warning "CMake build failed."
    fi

    if command_exists make; then
        status "Building llama.cpp with make..."
        if make -C "$LLAMA_DIR" -j "$jobs" llama-server; then
            return 0
        fi
        warning "make build failed."
    fi

    return 1
}

ensure_llama_cpp() {
    local binary_path

    if binary_path="$(llama_server_path)"; then
        status "llama.cpp detected and built."
        install_llama_server_link "$binary_path"
        return 0
    fi

    if ! command_exists git; then
        warning "git is not installed, so llama.cpp cannot be installed automatically."
        return 1
    fi

    if [ -d "$LLAMA_DIR/.git" ]; then
        status "Updating existing llama.cpp checkout..."
        if ! git -C "$LLAMA_DIR" pull --ff-only; then
            warning "Failed to update llama.cpp. Trying to build the existing checkout."
        fi
    elif [ -d "$LLAMA_DIR" ]; then
        warning "Found $LLAMA_DIR, but it is not a git checkout. Trying to build it as-is."
    else
        status "Cloning llama.cpp to $LLAMA_DIR..."
        if ! git clone https://github.com/ggerganov/llama.cpp "$LLAMA_DIR"; then
            warning "Failed to clone llama.cpp."
            return 1
        fi
    fi

    if ! command_exists cmake && ! command_exists make; then
        warning "Neither cmake nor make is installed, so llama.cpp cannot be built automatically."
        return 1
    fi

    if build_llama_cpp && binary_path="$(llama_server_path)"; then
        status "llama.cpp built successfully."
        install_llama_server_link "$binary_path"
        return 0
    fi

    warning "llama.cpp is present but llama-server could not be built automatically."
    warning "Install build tools and retry setup, or build manually in $LLAMA_DIR."
    return 1
}

ensure_default_llama_model() {
    local model_count
    local default_model

    model_count="$(find "$HOME/.lmstudio/models" -type f -name '*.gguf' 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${model_count:-0}" -gt 0 ]; then
        status "llama.cpp model files detected."
        return 0
    fi

    status "No local GGUF models found. Downloading the default llama.cpp model..."
    if ! default_model="$(default_llama_model 2>/dev/null)"; then
        warning "Could not determine the default llama.cpp model."
        return 1
    fi

    if "$PROJECT_ROOT/.venv/bin/python" - <<'PY'
from cli.setup import download_default_model
raise SystemExit(0 if download_default_model() else 1)
PY
    then
        status "Default llama.cpp model ready: $default_model"
        return 0
    fi

    warning "Failed to download the default llama.cpp model automatically."
    return 1
}

ensure_path_in_file() {
    local target_file="$1"
    local start_marker="# >>> yips path >>>"
    local end_marker="# <<< yips path <<<"

    touch "$target_file"

    if grep -Fq "$start_marker" "$target_file"; then
        return
    fi

    cat >> "$target_file" <<EOF

$start_marker
if [[ ":\$PATH:" != *":\$HOME/.local/bin:"* ]]; then
    export PATH="\$HOME/.local/bin:\$PATH"
fi
$end_marker
EOF

    status "Updated shell PATH in $target_file"
}

# 1. Check for Python 3
if ! command -v python3 &> /dev/null; then
    error "python3 is not installed. Please install Python 3."
fi

# 2. Check for python3-venv and create .venv if missing
if [ ! -d ".venv" ]; then
    status "Creating virtual environment..."
    if ! python3 -m venv .venv 2>/dev/null; then
        error "Failed to create virtual environment. You may need to install python3-venv (e.g., sudo apt install python3-venv)."
    fi
fi

# 3. Update Python dependencies
if [ -f "requirements.txt" ]; then
    mkdir -p .yips
    MD5_FILE=".yips/requirements.md5"
    
    # Calculate hash of requirements.txt
    CURRENT_MD5=$(md5sum requirements.txt | cut -d' ' -f1)
    
    # Also check if the .venv actually has something installed (basic check)
    if [ ! -f "$MD5_FILE" ] || [ "$CURRENT_MD5" != "$(cat "$MD5_FILE")" ]; then
        status "Updating Python dependencies..."
        source .venv/bin/activate
        pip install --upgrade pip --quiet
        pip install -r requirements.txt --quiet
        echo "$CURRENT_MD5" > "$MD5_FILE"
        status "Python dependencies updated successfully."
    fi
fi

# 4. Check for Node.js dependencies
if [ -f "package.json" ]; then
    # Only try to install if an 'app' directory exists as referenced in package.json
    if [ -d "app" ]; then
        if command -v npm &> /dev/null; then
            mkdir -p .yips
            MD5_FILE=".yips/package.md5"
            CURRENT_MD5=$(md5sum package.json | cut -d' ' -f1)
            
            if [ ! -f "$MD5_FILE" ] || [ "$CURRENT_MD5" != "$(cat "$MD5_FILE")" ]; then
                status "Updating Node.js dependencies..."
                npm install --prefix app --quiet
                echo "$CURRENT_MD5" > "$MD5_FILE"
                status "Node.js dependencies updated successfully."
            fi
        else
            warning "package.json found but npm is not installed. Skipping Node.js dependencies."
        fi
    fi
fi

# 5. Initialize config if missing
if [ ! -f ".yips_config.json" ]; then
    DEFAULT_MODEL="$(default_llama_model)"
    status "Initializing default configuration..."
    cat > .yips_config.json <<EOF
{
  "backend": "llamacpp",
  "model": "$DEFAULT_MODEL",
  "verbose": true,
  "streaming": true
}
EOF
fi

# 6. Ensure required directories exist
mkdir -p .yips/memory
mkdir -p .yips/logs

# 7. Install portable shell command
chmod +x "$PROJECT_ROOT/startup.sh" "$YIPS_LAUNCHER_PATH"
CURRENT_COMMAND_TARGET=""
if [ -L "$YIPS_COMMAND_PATH" ] || [ -e "$YIPS_COMMAND_PATH" ]; then
    CURRENT_COMMAND_TARGET="$(readlink -f "$YIPS_COMMAND_PATH" 2>/dev/null || true)"
fi

if [ "$CURRENT_COMMAND_TARGET" = "$YIPS_LAUNCHER_PATH" ]; then
    status "Shell command already installed: $YIPS_COMMAND_PATH"
else
    mkdir -p "$LOCAL_BIN_DIR"
    if ln -sfn "$YIPS_LAUNCHER_PATH" "$YIPS_COMMAND_PATH"; then
        status "Installed shell command: $YIPS_COMMAND_PATH -> $YIPS_LAUNCHER_PATH"
    else
        warning "Could not install $YIPS_COMMAND_PATH automatically. Run this setup script from a normal shell to refresh the launcher."
    fi
fi

ensure_path_in_file "$HOME/.bashrc"
ensure_path_in_file "$HOME/.bash_profile"

case ":$PATH:" in
    *":$LOCAL_BIN_DIR:"*) ;;
    *) export PATH="$LOCAL_BIN_DIR:$PATH" ;;
esac

# 8. Ensure llama.cpp is installed and built
ensure_llama_cpp || true

# 8b. Ensure a default llama.cpp model exists on fresh installs
ensure_default_llama_model || true

# 9. Check for Claude CLI
if ! command -v claude &> /dev/null; then
    warning "Claude CLI ('claude') not found in PATH. Some backends may not work."
fi
