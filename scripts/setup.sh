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
    status "Initializing default configuration..."
    echo '{
  "backend": "llamacpp",
  "model": "lmstudio-community/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf",
  "verbose": true,
  "streaming": true
}' > .yips_config.json
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

case ":$PATH:" in
    *":$LOCAL_BIN_DIR:"*) ;;
    *)
        warning "$LOCAL_BIN_DIR is not in PATH. Add 'export PATH=\"$LOCAL_BIN_DIR:\$PATH\"' to your shell profile to run 'yips' directly."
        ;;
esac

# 8. Priority Check: llama.cpp
LLAMA_DIR="$HOME/llama.cpp"
if [ -d "$LLAMA_DIR" ]; then
    # Check if llama-server exists (usually in build/bin/llama-server or bin/llama-server)
    if [ -f "$LLAMA_DIR/build/bin/llama-server" ] || [ -f "$LLAMA_DIR/bin/llama-server" ]; then
        status "llama.cpp detected and built."
    else
        warning "llama.cpp directory found at $LLAMA_DIR, but llama-server binary is missing."
        warning "You may need to build it: cd $LLAMA_DIR && cmake -B build && cmake --build build --config Release -j"
    fi
else
    warning "llama.cpp not found at $LLAMA_DIR. This is the preferred backend for Yips."
fi

# 9. Check for Claude CLI
if ! command -v claude &> /dev/null; then
    warning "Claude CLI ('claude') not found in PATH. Some backends may not work."
fi
