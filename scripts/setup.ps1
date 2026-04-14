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

function Test-PythonSeesCmake {
    <#
    .SYNOPSIS
        True if cli/setup.py check_build_tools / shutil.which would find cmake (same PATH as this session).
    #>
    param([string]$PythonExe)
    $p = Start-Process -FilePath $PythonExe `
        -ArgumentList @('-c', "import shutil, sys; sys.exit(0 if shutil.which('cmake') else 1)") `
        -Wait -PassThru -NoNewWindow
    return ($p.ExitCode -eq 0)
}

function Ensure-Cmake {
    <#
    .SYNOPSIS
        Ensure cmake is on PATH: use existing install, else pip (venv), else winget.
    #>
    param(
        [string]$ProjectRoot,
        [string]$PythonExe
    )
    $VenvScripts = Join-Path $ProjectRoot ".venv\Scripts"
    if (Test-Path $VenvScripts) {
        $env:Path = "$VenvScripts;$env:Path"
    }
    if (Test-PythonSeesCmake $PythonExe) {
        return $true
    }

    Write-Status "CMake not found. Installing CMake into the virtual environment (for llama.cpp builds)..."
    & $PythonExe -m pip install "cmake>=3.20" --quiet
    if ($LASTEXITCODE -eq 0) {
        $env:Path = "$VenvScripts;$env:Path"
        if (Test-PythonSeesCmake $PythonExe) {
            return $true
        }
    }

    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
        Write-Status "Trying CMake via winget..."
        & winget install Kitware.CMake -e --accept-package-agreements --accept-source-agreements
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path    = "$machinePath;$userPath"
        if (Test-PythonSeesCmake $PythonExe) {
            return $true
        }
    }

    return $false
}

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
if (-not $ExistingBin) {
    $InPath = Get-Command "llama-server" -ErrorAction SilentlyContinue
    if ($InPath) { $ExistingBin = $InPath.Source }
}

$NeedBuild = $false
if (-not $ExistingBin) {
    Write-Status "llama-server not found. Will attempt to build llama.cpp..."
    $NeedBuild = $true
} else {
    # Rebuild if an NVIDIA GPU is present but the existing llama.cpp build is not CUDA-enabled.
    $NvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if ($NvidiaSmi) {
        $BuildMode = (& $PythonExe -c "import sys, os; sys.path.insert(0, r'$ProjectRoot'); from cli.setup import detect_llama_build_mode; print(detect_llama_build_mode())" 2>$null).Trim()
        if ($BuildMode -ne "cuda") {
            Write-Warn "NVIDIA GPU detected but llama.cpp is not CUDA-enabled ($BuildMode). Rebuilding for CUDA..."
            $NeedBuild = $true
        } else {
            Write-Status "llama-server already installed with CUDA: $ExistingBin"
        }
    } else {
        Write-Status "llama-server already installed: $ExistingBin"
    }
}

if ($NeedBuild) {
    $HasGit = Get-Command "git" -ErrorAction SilentlyContinue
    if (-not $HasGit) {
        Write-Warn "git not found — cannot build llama.cpp. Install git and re-run setup."
    } elseif (-not (Ensure-Cmake -ProjectRoot $ProjectRoot -PythonExe $PythonExe)) {
        Write-Warn "cmake not found — could not install CMake automatically (pip and winget). Install CMake manually and re-run setup."
    } else {
        Write-Status "Building llama.cpp (this may take several minutes)..."
        $VenvScripts = Join-Path $ProjectRoot ".venv\Scripts"
        if (Test-Path $VenvScripts) {
            $env:Path = "$VenvScripts;$env:Path"
        }
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

# --- 8. Ensure a default llama.cpp model exists -------------------------------
$ModelsDir = Join-Path $env:USERPROFILE ".yips\models"
if (-not (Test-Path $ModelsDir)) { New-Item -ItemType Directory $ModelsDir | Out-Null }

$Models = Get-ChildItem -Path $ModelsDir -Filter "*.gguf" -Recurse -ErrorAction SilentlyContinue
if (-not $Models) {
    Write-Status "No local GGUF models found. Downloading the default llama.cpp model..."
    & $PythonExe -c @"
import sys, os
sys.path.insert(0, r'$ProjectRoot')
from cli.setup import download_default_model
r = download_default_model()
sys.exit(0 if r else 1)
"@
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Default llama.cpp model ready."
    } else {
        Write-Warn "Failed to download the default llama.cpp model automatically."
    }
} else {
    Write-Status "llama.cpp model files detected."
}

Write-Host ""
Write-Status "Setup complete. Run startup.bat to launch Yips."
