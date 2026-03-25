#Requires -Version 5.1
<#
.SYNOPSIS
    Yips Auto-Installer/Updater for Windows
#>

$ErrorActionPreference = 'Stop'

# --- Helpers -------------------------------------------------------------------
function Write-Status($msg)  { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "Warning: $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

# --- Resolve project root (one level up from this script's directory) ----------
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# --- 1. Check for Python -------------------------------------------------------
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Err "Python is not installed or not in PATH.`nInstall from https://python.org and add it to PATH."
}
Write-Status "Python detected: $((python --version 2>&1))."

# --- 2. Create virtual environment if missing ----------------------------------
if (-not (Test-Path ".venv")) {
    Write-Status "Creating virtual environment..."
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Write-Err "Failed to create virtual environment." }
    Write-Status "Virtual environment created."
} else {
    Write-Status "Virtual environment already exists."
}

$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

# --- 3. Update Python dependencies ---------------------------------------------
if (Test-Path "requirements.txt") {
    if (-not (Test-Path ".yips")) { New-Item -ItemType Directory ".yips" | Out-Null }

    $CurrentHash = (& $PythonExe -c @"
import hashlib, sys
print(hashlib.md5(open(sys.argv[1],'rb').read()).hexdigest())
"@ "requirements.txt" 2>$null)

    $HashFile = ".yips\requirements.md5"
    $StoredHash = if (Test-Path $HashFile) { Get-Content $HashFile -Raw } else { "" }

    if ($CurrentHash.Trim() -ne $StoredHash.Trim()) {
        Write-Status "Updating Python dependencies..."
        & $PythonExe -m pip install --upgrade pip --quiet
        & $PythonExe -m pip install -r requirements.txt --quiet
        if ($LASTEXITCODE -ne 0) { Write-Err "Failed to install dependencies." }
        $CurrentHash | Set-Content $HashFile -NoNewline
        Write-Status "Python dependencies updated successfully."
    } else {
        Write-Status "Python dependencies are up to date."
    }
}

# --- 4. Initialize config if missing -------------------------------------------
if (-not (Test-Path ".yips_config.json")) {
    Write-Status "Initializing default configuration..."
    @{
        backend   = "claude"
        model     = "sonnet"
        verbose   = $true
        streaming = $true
    } | ConvertTo-Json | Set-Content ".yips_config.json" -Encoding UTF8
    Write-Status "Configuration initialized."
}

# --- 5. Ensure required directories exist --------------------------------------
@(".yips\memory", ".yips\logs") | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory $_ | Out-Null }
}
Write-Status "Directories ready."

# --- 6. Check for Claude CLI ---------------------------------------------------
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Status "Claude CLI detected."
} else {
    Write-Warn "Claude CLI ('claude') not found in PATH. Some backends may not work."
}

# --- 7. Ensure llama.cpp is installed -----------------------------------------
$LlamaDir   = Join-Path $env:USERPROFILE "llama.cpp"
$BinPaths   = @(
    (Join-Path $LlamaDir "build\bin\Release\llama-server.exe"),
    (Join-Path $LlamaDir "build\bin\llama-server.exe"),
    (Join-Path $LlamaDir "bin\llama-server.exe"),
    (Join-Path $LlamaDir "llama-server.exe")
)
$ExistingBin = $BinPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

$NeedBuild = $false
if (-not $ExistingBin) {
    Write-Status "llama-server not found. Will attempt to build llama.cpp..."
    $NeedBuild = $true
} else {
    # Rebuild if CUDA is now available but the existing build is CPU-only
    $CachePath = Join-Path $LlamaDir "build\CMakeCache.txt"
    $NvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if ($NvidiaSmi -and (Test-Path $CachePath)) {
        $CacheText = Get-Content $CachePath -Raw
        if ($CacheText -notmatch "GGML_CUDA:BOOL=ON") {
            Write-Warn "CUDA-capable GPU detected but llama.cpp built without CUDA. Rebuilding..."
            $NeedBuild = $true
        } else {
            Write-Status "llama-server already installed with CUDA: $ExistingBin"
        }
    } else {
        Write-Status "llama-server already installed: $ExistingBin"
    }
}

if ($NeedBuild) {
    $HasGit   = Get-Command "git"   -ErrorAction SilentlyContinue
    $HasCMake = Get-Command "cmake" -ErrorAction SilentlyContinue
    if (-not $HasGit) {
        Write-Warn "git not found — cannot build llama.cpp. Install git and re-run setup."
    } elseif (-not $HasCMake) {
        Write-Warn "cmake not found — cannot build llama.cpp. Install CMake and re-run setup."
    } else {
        Write-Status "Building llama.cpp (this may take several minutes)..."
        # Write binary path to a temp file so stdout stays free for Rich output.
        $TempOut = [System.IO.Path]::GetTempFileName()
        & $PythonExe -c @"
import sys, os, traceback
sys.path.insert(0, r'$ProjectRoot')
os.chdir(r'$ProjectRoot')
try:
    from cli.setup import install_llama_server
    r = install_llama_server()
    if r:
        open(r'$TempOut', 'w').write(r)
    sys.exit(0 if r else 1)
except Exception:
    traceback.print_exc()
    sys.exit(2)
"@
        $ExitCode  = $LASTEXITCODE
        $BuildPath = ""
        if (Test-Path $TempOut) {
            $raw = Get-Content $TempOut -Raw
            if ($raw) { $BuildPath = $raw.Trim() }
            Remove-Item $TempOut -ErrorAction SilentlyContinue
        }
        if ($ExitCode -eq 0 -and $BuildPath) {
            Write-Status "llama.cpp built successfully: $BuildPath"
        } else {
            Write-Warn "llama.cpp build failed (exit $ExitCode). Yips will use Claude CLI backend."
        }
    }
}

Write-Host ""
Write-Status "Setup complete. Run startup.bat to launch Yips."
