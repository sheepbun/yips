$ErrorActionPreference = "Stop"

$Repo = "sheepbun/yips"
$Binary = "yips-windows.exe"
$DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Binary"
$InstallDir = "$env:USERPROFILE\AppData\Local\Microsoft\WindowsApps"

Write-Host "Downloading Yips ($Binary) from $DownloadUrl..."
If (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

$DestPath = Join-Path $InstallDir "yips.exe"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $DestPath

Write-Host "Yips installed successfully to $DestPath."
Write-Host "Ensure $InstallDir is in your PATH."
