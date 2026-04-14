Write-Host "Building Windows binary for Yips..."
pip install pyinstaller
pyinstaller --name yips-windows --onefile cli/main.py
Write-Host "Build complete. Check the 'dist' folder for 'yips-windows.exe'."
