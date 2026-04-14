#Requires -Version 5.1
<#
.SYNOPSIS
    Yips Auto-Installer/Updater for Windows (Silent Mode)
#>

$ErrorActionPreference = 'SilentlyContinue'

# --- Resolve project root (one level up from this script's directory) ----------
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# --- 1. Check for Python -------------------------------------------------------
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    exit 1
}

# --- 2. Create virtual environment if missing ----------------------------------
if (-not (Test-Path ".venv")) {
    python -m venv .venv > $null 2>&1
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

# --- 3. Update Python dependencies ---------------------------------------------
if (Test-Path "requirements.txt") {
    if (-not (Test-Path ".yips")) { New-Item -ItemType Directory ".yips" -Force | Out-Null }

    $CurrentHash = (& $PythonExe -c @"
import hashlib, sys
print(hashlib.md5(open(sys.argv[1],'rb').read()).hexdigest())
"@ "requirements.txt" 2>$null)

    $HashFile = ".yips\requirements.md5"
    $StoredHash = if (Test-Path $HashFile) { Get-Content $HashFile -Raw } else { "" }

    if ($CurrentHash.Trim() -ne $StoredHash.Trim()) {
        & $PythonExe -m pip install --upgrade pip --quiet > $null 2>&1
        & $PythonExe -m pip install -r requirements.txt --quiet > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            $CurrentHash | Set-Content $HashFile -NoNewline
        }
    }
}

# --- 4. Initialize config if missing -------------------------------------------
if (-not (Test-Path ".yips_config.json")) {
    @{
        backend   = "claude"
        model     = "sonnet"
        verbose   = $true
        streaming = $true
    } | ConvertTo-Json | Set-Content ".yips_config.json" -Encoding UTF8
}

# --- 5. Ensure required directories exist --------------------------------------
@(".yips\memory", ".yips\logs") | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory $_ -Force | Out-Null }
}

# --- 6. Check for llama.cpp / model -------------------------------------------
# (Simplified: we don't block or rebuild here in silent mode if something exists)
$LlamaDir   = Join-Path $env:USERPROFILE "llama.cpp"
$BinPaths   = @(
    (Join-Path $LlamaDir "build\bin\Release\llama-server.exe"),
    (Join-Path $LlamaDir "build\bin\llama-server.exe"),
    (Join-Path $LlamaDir "bin\llama-server.exe"),
    (Join-Path $LlamaDir "llama-server.exe")
)
$ExistingBin = $BinPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

# If missing critical components, let the background thread in Python handle it (it already does)
exit 0
