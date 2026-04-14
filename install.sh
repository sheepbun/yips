#!/bin/bash
set -e

REPO="sheepbun/yips"
TAG="v0.1.44"
BINARY="yips-core-linux"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$BINARY"

INSTALL_ROOT="$HOME/.yips"
BIN_DIR="$INSTALL_ROOT/bin"

echo "--- Yips Linux Installer ---"
echo "Target: $INSTALL_ROOT"

# 1. Create directory structure
mkdir -p "$BIN_DIR"

# 2. Download the direct binary
echo "Downloading Core Binary..."
curl -L -o "$BIN_DIR/yips" "$DOWNLOAD_URL"
chmod +x "$BIN_DIR/yips"

# 3. Handle PATH (Update .bashrc or .zshrc)
SHELL_RC=""
if [[ "$SHELL" == */zsh ]]; then
    SHELL_RC="$HOME/.zshrc"
elif [[ "$SHELL" == */bash ]]; then
    SHELL_RC="$HOME/.bashrc"
fi

if [[ -n "$SHELL_RC" ]]; then
    if ! grep -q "$BIN_DIR" "$SHELL_RC"; then
        echo "Updating $SHELL_RC..."
        echo -e "\n# Yips CLI\nexport PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
        echo "Added $BIN_DIR to PATH in $SHELL_RC."
    fi
fi

echo "----------------------------"
echo "Installation Complete! Run 'yips' to get started."
