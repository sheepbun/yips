$ErrorActionPreference = "Stop"

$Repo = "sheepbun/yips"
$BinaryName = "yips-core-windows.exe"
$Tag = "v0.1.46"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$BinaryName"

$AppDataYips = Join-Path $env:APPDATA ".yips"
$BinDir = Join-Path $AppDataYips "bin"
$DestPath = Join-Path $BinDir "yips.exe"

Write-Host "--- Yips PowerShell Installer ---"
Write-Host "Target: $AppDataYips"

# 1. Create directory structure
If (!(Test-Path $BinDir)) {
    Write-Host "Creating directory structure..."
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
}

# 2. Download the direct binary
Write-Host "Downloading Core Binary..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $DestPath

# 3. Add to User PATH if not already there
Write-Host "Updating PATH environment variable..."
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", $UserPath + ";" + $BinDir, "User")
    $env:Path += ";$BinDir"
    Write-Host "Added $BinDir to User PATH."
}

Write-Host "----------------------------"
Write-Host "Installation Complete! Run 'yips' to get started."
