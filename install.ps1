$ErrorActionPreference = "Stop"

$Repo = "sheepbun/yips"
$BinaryName = "yips-windows.exe"
$Tag = "v0.1.44"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$BinaryName"

$TempPath = Join-Path $env:TEMP $BinaryName

Write-Host "--- Yips Installer Wrapper ---"
Write-Host "Downloading $BinaryName..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempPath

Write-Host "Launching $BinaryName to complete installation..."
& $TempPath --onboard
