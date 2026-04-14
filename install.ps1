$ErrorActionPreference = "Stop"

$Repo = "sheepbun/yips"
$BinaryName = "yips.exe"
$Tag = "v0.1.44"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/yips-windows.exe"

$AppDataYips = Join-Path $env:APPDATA ".yips"
$BinDir = Join-Path $AppDataYips "bin"

Write-Host "--- Yips Windows Installer ---"
Write-Host "Target: $AppDataYips"

# 1. Create directory structure
If (!(Test-Path $BinDir)) {
    Write-Host "Creating directory structure..."
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
}

# 2. Download the binary
$DestPath = Join-Path $BinDir $BinaryName
Write-Host "Downloading $BinaryName from GitHub..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $DestPath

# 3. Add to User PATH if not already there
Write-Host "Updating PATH environment variable..."
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", $UserPath + ";" + $BinDir, "User")
    $env:Path += ";$BinDir"
    Write-Host "Added $BinDir to User PATH."
} else {
    Write-Host "$BinDir is already in PATH."
}

Write-Host "----------------------------"
Write-Host "Installation Complete!"
Write-Host "You may need to restart your terminal for 'yips' to be recognized."
Write-Host "Run 'yips' to get started."
