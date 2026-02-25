import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";
import { statfsSync } from "node:fs";

export interface SystemSpecs {
  ramGb: number;
  vramGb: number;
  totalMemoryGb: number;
  diskFreeGb: number;
  gpuType: "nvidia" | "amd" | "unknown";
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function getRamGb(): number {
  return roundOne(totalmem() / (1024 ** 3));
}

function getNvidiaVramGb(): number {
  try {
    const result = execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );

    const totalMb = result
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => Number(line))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((sum, value) => sum + value, 0);

    return totalMb > 0 ? roundOne(totalMb / 1024) : 0;
  } catch {
    return 0;
  }
}

function getAmdVramGb(): number {
  try {
    const paths = globSync("/sys/class/drm/card*/device/mem_info_vram_total");

    if (paths.length === 0) {
      return 0;
    }

    const totalBytes = paths
      .map((path) => readFileSync(path, "utf8").trim())
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((sum, value) => sum + value, 0);

    return totalBytes > 0 ? roundOne(totalBytes / (1024 ** 3)) : 0;
  } catch {
    return 0;
  }
}

function getModelsDir(): string {
  const override = process.env["YIPS_MODELS_DIR"]?.trim();
  if (override && override.length > 0) {
    return override;
  }
  return join(homedir(), ".yips", "models");
}

function getDiskFreeGb(path: string): number {
  try {
    const fsStats = statfsSync(path);
    const blockSize = Number(fsStats.bsize);
    const available = Number(fsStats.bavail);
    if (!Number.isFinite(blockSize) || !Number.isFinite(available) || blockSize <= 0 || available < 0) {
      return 0;
    }
    return roundOne((blockSize * available) / (1024 ** 3));
  } catch {
    return 0;
  }
}

let cachedSpecs: SystemSpecs | null = null;

export function getSystemSpecs(): SystemSpecs {
  if (cachedSpecs) {
    return cachedSpecs;
  }

  const ramGb = getRamGb();
  const nvidiaVramGb = getNvidiaVramGb();
  const amdVramGb = nvidiaVramGb > 0 ? 0 : getAmdVramGb();
  const vramGb = nvidiaVramGb > 0 ? nvidiaVramGb : amdVramGb;
  const gpuType: SystemSpecs["gpuType"] = nvidiaVramGb > 0 ? "nvidia" : amdVramGb > 0 ? "amd" : "unknown";

  cachedSpecs = {
    ramGb,
    vramGb,
    totalMemoryGb: roundOne(ramGb + vramGb),
    diskFreeGb: getDiskFreeGb(getModelsDir()),
    gpuType
  };

  return cachedSpecs;
}

export function clearSystemSpecsCache(): void {
  cachedSpecs = null;
}
