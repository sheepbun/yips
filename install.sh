#!/bin/bash
set -e

REPO="sheepbun/yips"
TAG="v0.1.44"
BINARY="yips-linux"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$BINARY"

TEMP_PATH="/tmp/$BINARY"

echo "--- Yips Installer Wrapper ---"
echo "Downloading $BINARY from GitHub..."
curl -L -o "$TEMP_PATH" "$DOWNLOAD_URL"
chmod +x "$TEMP_PATH"

echo "Launching $BINARY to complete installation..."
"$TEMP_PATH" --onboard
