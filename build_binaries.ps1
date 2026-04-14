Write-Host "--- Yips Build Script ---"

# Ensure PyInstaller and requirements are available
& .venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller

# 1. Build the CORE BINARY (The actual app)
Write-Host "Building Core App..."
& .venv\Scripts\python.exe -m PyInstaller --name yips-core-windows --onefile cli/main.py

# 2. Build the INSTALLER WIZARD (The public-facing wizard)
Write-Host "Building Installer Wizard..."
& .venv\Scripts\python.exe -m PyInstaller --name yips-installer-windows --onefile cli/installer_wizard.py

Write-Host "--- Build Complete ---"
Write-Host "Assets in 'dist/' folder:"
Write-Host "  - yips-core-windows.exe (The app binary used by scripts/wizard)"
Write-Host "  - yips-installer-windows.exe (The public installer wizard)"
