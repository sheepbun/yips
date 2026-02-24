#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LLAMA_REPO_DIR="${HOME}/llama.cpp"
LLAMA_BUILD_DIR="${LLAMA_REPO_DIR}/build"
LLAMA_SERVER_BIN="${LLAMA_BUILD_DIR}/bin/llama-server"
YIPS_DIR="${HOME}/.yips"
YIPS_MODELS_DIR="${YIPS_DIR}/models"
YIPS_ENV_FILE="${YIPS_DIR}/env.sh"
YIPS_BIN_DIR="${HOME}/.local/bin"
YIPS_LAUNCHER_PATH="${YIPS_BIN_DIR}/yips"
YIPS_CONFIG_PATH="${YIPS_DIR}/config.json"

OS_NAME=""
PKG_MANAGER=""
INSTALL_PREFIX=()
APT_UPDATED=0
PACMAN_UPDATED=0
INSTALL_CUDA=0
NODE_RUNTIME_DIAG=""

log() {
  printf '[install] %s\n' "$*"
}

warn() {
  printf '[install][warn] %s\n' "$*" >&2
}

die() {
  printf '[install][error] %s\n' "$*" >&2
  exit 1
}

on_error() {
  local line="${1:-unknown}"
  die "Installer failed near line ${line}. Re-run with: bash -x ./install.sh"
}
trap 'on_error "${LINENO}"' ERR

detect_platform() {
  local uname_out
  uname_out="$(uname -s)"
  case "$uname_out" in
    Linux) OS_NAME="linux" ;;
    Darwin) OS_NAME="macos" ;;
    *) die "Unsupported OS: ${uname_out}" ;;
  esac

  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
  elif command -v pacman >/dev/null 2>&1; then
    PKG_MANAGER="pacman"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
  elif command -v brew >/dev/null 2>&1; then
    PKG_MANAGER="brew"
  else
    die "No supported package manager found. Install dependencies manually: git cmake build tools nodejs npm curl."
  fi

  if [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
    INSTALL_PREFIX=(sudo)
  else
    INSTALL_PREFIX=()
  fi

  log "Detected OS=${OS_NAME}, package manager=${PKG_MANAGER}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cuda)
        INSTALL_CUDA=1
        shift
        ;;
      -h|--help)
        cat <<'EOF'
Usage: ./install.sh [--cuda]

Options:
  --cuda    Install CUDA toolkit via package manager and build llama.cpp with CUDA.
EOF
        exit 0
        ;;
      *)
        die "Unknown argument: $1 (try --help)"
        ;;
    esac
  done
}

install_packages_apt() {
  local packages=("$@")
  if [[ "$APT_UPDATED" -eq 0 ]]; then
    "${INSTALL_PREFIX[@]}" apt-get update -y
    APT_UPDATED=1
  fi
  "${INSTALL_PREFIX[@]}" apt-get install -y "${packages[@]}"
}

install_packages_dnf() {
  local packages=("$@")
  "${INSTALL_PREFIX[@]}" dnf install -y "${packages[@]}"
}

install_packages_pacman() {
  local packages=("$@")
  if [[ "$PACMAN_UPDATED" -eq 0 ]]; then
    log "Arch detected: using full-upgrade pacman workflow (Syu)."
    "${INSTALL_PREFIX[@]}" pacman -Syu --needed --noconfirm "${packages[@]}"
    PACMAN_UPDATED=1
  else
    "${INSTALL_PREFIX[@]}" pacman -S --needed --noconfirm "${packages[@]}"
  fi
}

install_packages_brew() {
  local packages=("$@")
  brew install "${packages[@]}"
}

install_cuda_toolkit() {
  if [[ "${INSTALL_CUDA}" -ne 1 ]]; then
    return
  fi

  log "--cuda enabled: installing CUDA toolkit prerequisites"
  case "$PKG_MANAGER" in
    apt)
      install_packages_apt nvidia-cuda-toolkit
      ;;
    pacman)
      install_packages_pacman cuda
      ;;
    dnf)
      install_packages_dnf cuda
      ;;
    brew)
      warn "CUDA installation is not managed on macOS via Homebrew by this script; continuing without toolkit install."
      ;;
    *)
      die "Unsupported package manager for CUDA install: ${PKG_MANAGER}"
      ;;
  esac
}

ensure_prerequisites() {
  local missing=()
  local cmd
  for cmd in git cmake curl node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done

  if [[ "${#missing[@]}" -eq 0 ]]; then
    log "Prerequisites already available."
    return
  fi

  log "Installing missing prerequisites: ${missing[*]}"
  case "$PKG_MANAGER" in
    apt)
      install_packages_apt git cmake build-essential curl nodejs npm
      ;;
    pacman)
      install_packages_pacman git cmake base-devel curl nodejs npm
      ;;
    dnf)
      install_packages_dnf git cmake gcc-c++ make curl nodejs npm
      ;;
    brew)
      install_packages_brew git cmake curl node
      ;;
    *)
      die "Unsupported package manager: ${PKG_MANAGER}"
      ;;
  esac
}

capture_node_runtime_diag() {
  local node_diag npm_diag
  node_diag="$(node -v 2>&1 || true)"
  npm_diag="$(npm -v 2>&1 || true)"
  NODE_RUNTIME_DIAG=$'node -v:\n'"${node_diag}"$'\n\nnpm -v:\n'"${npm_diag}"
}

node_runtime_healthy() {
  node -v >/dev/null 2>&1 && npm -v >/dev/null 2>&1
}

repair_node_runtime_arch() {
  warn "Detected broken Node runtime linkage. Attempting Arch self-heal reinstall (nodejs/npm/simdjson)."
  install_packages_pacman nodejs npm simdjson
}

ensure_node_runtime_healthy() {
  if node_runtime_healthy; then
    return
  fi

  capture_node_runtime_diag

  if [[ "$PKG_MANAGER" == "pacman" ]]; then
    repair_node_runtime_arch
    if node_runtime_healthy; then
      log "Node runtime self-heal succeeded."
      return
    fi
    capture_node_runtime_diag
    die $'Node runtime is still unhealthy after Arch self-heal.\nRun manually:\n  sudo pacman -Syu --needed nodejs npm simdjson\nThen retry ./install.sh\n\nDiagnostics:\n'"${NODE_RUNTIME_DIAG}"
  fi

  die $'Node runtime is unhealthy.\nPlease repair your Node installation and retry.\n\nDiagnostics:\n'"${NODE_RUNTIME_DIAG}"
}

setup_llama_repo() {
  if [[ -d "${LLAMA_REPO_DIR}/.git" ]]; then
    log "Updating existing llama.cpp checkout in ${LLAMA_REPO_DIR}"
    git -C "${LLAMA_REPO_DIR}" pull --ff-only
  else
    log "Cloning llama.cpp into ${LLAMA_REPO_DIR}"
    git clone https://github.com/ggerganov/llama.cpp "${LLAMA_REPO_DIR}"
  fi
}

num_jobs() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.logicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4
    return
  fi
  echo 4
}

build_llama_cpu() {
  log "Building llama.cpp (CPU mode)"
  # Ensure prior CUDA configure state does not leak into CPU fallback.
  rm -f "${LLAMA_BUILD_DIR}/CMakeCache.txt"
  rm -rf "${LLAMA_BUILD_DIR}/CMakeFiles"
  cmake -S "${LLAMA_REPO_DIR}" -B "${LLAMA_BUILD_DIR}" -DGGML_CUDA=OFF
  cmake --build "${LLAMA_BUILD_DIR}" -j "$(num_jobs)"
}

build_llama_cuda_then_fallback() {
  if [[ "${INSTALL_CUDA}" -eq 1 ]]; then
    log "--cuda enabled: attempting CUDA build first."
  fi

  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    if ! command -v nvcc >/dev/null 2>&1; then
      warn "NVIDIA GPU detected but nvcc is unavailable. Skipping CUDA build and using CPU mode."
      build_llama_cpu
      return
    fi
    log "NVIDIA GPU detected. Attempting CUDA build."
    if cmake -S "${LLAMA_REPO_DIR}" -B "${LLAMA_BUILD_DIR}" -DGGML_CUDA=ON &&
      cmake --build "${LLAMA_BUILD_DIR}" -j "$(num_jobs)"; then
      log "CUDA build succeeded."
      return
    fi
    warn "CUDA build failed. Falling back to CPU build."
  else
    log "No NVIDIA GPU detected. Using CPU build."
  fi
  build_llama_cpu
}

validate_llama_server_binary() {
  [[ -x "${LLAMA_SERVER_BIN}" ]] || die "llama-server not found at ${LLAMA_SERVER_BIN} after build."
  "${LLAMA_SERVER_BIN}" --help >/dev/null 2>&1 || true
  log "llama-server ready: ${LLAMA_SERVER_BIN}"
}

ensure_yips_dirs() {
  mkdir -p "${YIPS_MODELS_DIR}"
  mkdir -p "${YIPS_BIN_DIR}"
}

write_env_file() {
  local temp_file
  temp_file="$(mktemp)"
  if [[ -f "${YIPS_ENV_FILE}" ]]; then
    grep -vE '^export (LLAMA_SERVER_PATH|YIPS_LLAMA_SERVER_PATH|YIPS_LLAMA_MODELS_DIR|YIPS_CONFIG_PATH|YIPS_BIN_DIR)=' "${YIPS_ENV_FILE}" \
      | grep -vE '^export PATH="\$YIPS_BIN_DIR:\$PATH"$' >"${temp_file}" || true
  fi
  {
    echo "export LLAMA_SERVER_PATH=\"${LLAMA_SERVER_BIN}\""
    echo "export YIPS_LLAMA_SERVER_PATH=\"${LLAMA_SERVER_BIN}\""
    echo "export YIPS_LLAMA_MODELS_DIR=\"${YIPS_MODELS_DIR}\""
    echo "export YIPS_CONFIG_PATH=\"${YIPS_CONFIG_PATH}\""
    echo "export YIPS_BIN_DIR=\"${YIPS_BIN_DIR}\""
    echo 'export PATH="$YIPS_BIN_DIR:$PATH"'
  } >>"${temp_file}"
  mv "${temp_file}" "${YIPS_ENV_FILE}"
  chmod 600 "${YIPS_ENV_FILE}"
  log "Updated ${YIPS_ENV_FILE}"
}

install_yips_launcher() {
  cat >"${YIPS_LAUNCHER_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="${REPO_ROOT}"
if [[ ! -d "\${REPO_ROOT}" ]]; then
  echo "[yips launcher] Repository path not found: \${REPO_ROOT}" >&2
  exit 1
fi
cd "\${REPO_ROOT}"
# Default to source mode so launcher always reflects latest local commit.
# Set YIPS_USE_DIST=1 to prefer compiled output when desired.
if [[ "\${YIPS_USE_DIST:-0}" == "1" ]] && [[ -f "dist/index.js" ]]; then
  exec node dist/index.js "\$@"
fi
exec npm run dev -- "\$@"
EOF
  chmod +x "${YIPS_LAUNCHER_PATH}"
  log "Installed launcher: ${YIPS_LAUNCHER_PATH}"
}

update_yips_config() {
  log "Normalizing ${YIPS_CONFIG_PATH}"
  node - "${YIPS_CONFIG_PATH}" "${LLAMA_SERVER_BIN}" "${YIPS_MODELS_DIR}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = process.argv[2];
const llamaServerPath = process.argv[3];
const modelsDir = process.argv[4];

const defaults = {
  streaming: true,
  verbose: false,
  backend: "llamacpp",
  llamaBaseUrl: "http://127.0.0.1:8080",
  llamaServerPath,
  llamaModelsDir: modelsDir,
  llamaHost: "127.0.0.1",
  llamaPort: 8080,
  llamaContextSize: 8192,
  llamaGpuLayers: 999,
  llamaAutoStart: true,
  model: "default",
  nicknames: {}
};

let current = {};
if (fs.existsSync(configPath)) {
  try {
    current = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.warn(`[install][warn] Existing config unreadable, rewriting with defaults: ${String(error)}`);
    current = {};
  }
}

const merged = {
  ...defaults,
  ...current
};

if (typeof current.llamaServerPath !== "string" || current.llamaServerPath.trim().length === 0) {
  merged.llamaServerPath = llamaServerPath;
}
if (typeof current.llamaModelsDir !== "string" || current.llamaModelsDir.trim().length === 0) {
  merged.llamaModelsDir = modelsDir;
}
if (typeof current.llamaHost !== "string" || current.llamaHost.trim().length === 0) {
  merged.llamaHost = "127.0.0.1";
}
if (!Number.isInteger(current.llamaPort) || current.llamaPort <= 0) {
  merged.llamaPort = 8080;
}
if (typeof current.llamaBaseUrl !== "string" || current.llamaBaseUrl.trim().length === 0) {
  merged.llamaBaseUrl = `http://${merged.llamaHost}:${merged.llamaPort}`;
}
if (!Number.isInteger(current.llamaContextSize) || current.llamaContextSize <= 0) {
  merged.llamaContextSize = 8192;
}
if (!Number.isInteger(current.llamaGpuLayers) || current.llamaGpuLayers <= 0) {
  merged.llamaGpuLayers = 999;
}
if (typeof current.llamaAutoStart !== "boolean") {
  merged.llamaAutoStart = true;
}
if (!merged.nicknames || typeof merged.nicknames !== "object" || Array.isArray(merged.nicknames)) {
  merged.nicknames = {};
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
NODE
}

install_node_dependencies() {
  ensure_node_runtime_healthy
  log "Installing Node dependencies"
  (cd "${REPO_ROOT}" && npm install)
}

count_models() {
  find "${YIPS_MODELS_DIR}" -type f -name '*.gguf' 2>/dev/null | wc -l | tr -d ' '
}

print_summary() {
  local models_count
  models_count="$(count_models)"
  log "Install complete."
  echo
  echo "Summary:"
  echo "  - llama-server: ${LLAMA_SERVER_BIN}"
  echo "  - yips launcher: ${YIPS_LAUNCHER_PATH}"
  echo "  - Yips env file: ${YIPS_ENV_FILE}"
  echo "  - Models dir: ${YIPS_MODELS_DIR}"
  echo "  - .yips_config.json: ${YIPS_CONFIG_PATH}"
  echo "  - GGUF models detected: ${models_count}"
  echo
  echo "Next:"
  echo "  1) source \"${YIPS_ENV_FILE}\""
  echo "  2) cd \"${REPO_ROOT}\""
  echo "  3) npm run dev"
  if [[ "${models_count}" == "0" ]]; then
    echo "  4) In Yips, use /download (or /model) to fetch/select a GGUF model."
  fi
}

main() {
  parse_args "$@"
  detect_platform
  ensure_prerequisites
  ensure_node_runtime_healthy
  install_cuda_toolkit
  setup_llama_repo
  build_llama_cuda_then_fallback
  validate_llama_server_binary
  ensure_yips_dirs
  write_env_file
  install_node_dependencies
  update_yips_config
  install_yips_launcher
  print_summary
}

main "$@"
