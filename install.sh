#!/bin/bash
set -e

REPO="sheepbun/yips"
BINARY="yips-linux"
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$BINARY"
INSTALL_DIR="$HOME/.local/bin"

echo "Downloading Yips ($BINARY) from $DOWNLOAD_URL..."
mkdir -p "$INSTALL_DIR"
curl -L -o "$INSTALL_DIR/yips" "$DOWNLOAD_URL"
chmod +x "$INSTALL_DIR/yips"

echo "Yips installed successfully to $INSTALL_DIR/yips."
echo "Ensure $INSTALL_DIR is in your PATH."
