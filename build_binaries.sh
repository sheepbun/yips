#!/bin/bash
echo "Building Linux binary for Yips..."
pip install pyinstaller
pyinstaller --name yips-linux --onefile cli/main.py
echo "Build complete. Check the 'dist' folder for 'yips-linux'."
