#!/bin/bash
echo "--- Yips Build Script (Linux) ---"

# Ensure PyInstaller and requirements are available
pip install -r requirements.txt pyinstaller

# 1. Build the CORE BINARY
echo "Building Core App..."
pyinstaller --name yips-core-linux --onefile --add-data "package.json:." cli/main.py

# 2. Build the INSTALLER WIZARD
echo "Building Installer Wizard..."
pyinstaller --name yips-installer-linux --onefile cli/installer_wizard.py

echo "--- Build Complete ---"
echo "Assets in 'dist/' folder:"
echo "  - yips-core-linux (The app binary used by scripts/wizard)"
echo "  - yips-installer-linux (The public installer wizard)"
