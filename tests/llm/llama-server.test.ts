import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultConfig } from "#config/config";
import {
  ensureLlamaReady,
  formatLlamaStartupFailure,
  isLocalLlamaEndpoint,
  parseLlamaDeviceCount,
  resetLlamaForFreshSession,
  startLlamaServer,
  stopLlamaServer
} from "#llm/llama-server";
import type { AppConfig } from "#types/app-types";

function withConfig(patch: Partial<AppConfig>): AppConfig {
  return { ...getDefaultConfig(), ...patch };
}

function createMockProcess(exitCode: number | null = null): {
  process: {
    exitCode: number | null;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  stderr: PassThrough;
} {
  const stderr = new PassThrough();
  let currentExitCode = exitCode;
  const process = {
    get exitCode() {
      return currentExitCode;
    },
    set exitCode(value: number | null) {
      currentExitCode = value;
    },
    stderr,
    kill: vi.fn().mockImplementation(() => {
      currentExitCode = 0;
    })
  };
  return { process, stderr };
}

const originalPath = process.env["PATH"];
const originalHome = process.env["HOME"];
const originalLlamaServerPath = process.env["LLAMA_SERVER_PATH"];

afterEach(async () => {
  await stopLlamaServer();
  vi.unstubAllGlobals();
  if (originalPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
  if (originalLlamaServerPath === undefined) {
    delete process.env["LLAMA_SERVER_PATH"];
  } else {
    process.env["LLAMA_SERVER_PATH"] = originalLlamaServerPath;
  }
});

describe("ensureLlamaReady", () => {
  it("reports ready when /health returns success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200, statusText: "OK" }))
    );
    const result = await ensureLlamaReady(withConfig({ model: "default" }));
    expect(result.ready).toBe(true);
    expect(result.started).toBe(false);
  });

  it("returns actionable failure when auto-start is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await ensureLlamaReady(withConfig({ model: "qwen.gguf", llamaAutoStart: false }));
    expect(result.ready).toBe(false);
    expect(result.failure?.message).toContain("auto-start is disabled");
  });
});

describe("startLlamaServer", () => {
  it("returns binary-not-found when llama-server cannot be resolved", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "yips-llama-home-"));
    process.env["HOME"] = fakeHome;
    process.env["PATH"] = "";
    process.env["LLAMA_SERVER_PATH"] = join(fakeHome, "missing-llama-server");

    const result = await startLlamaServer(
      withConfig({
        model: "qwen.gguf",
        llamaServerPath: join(fakeHome, "also-missing")
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("binary-not-found");
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("returns model-not-found when binary exists but model is unresolved", async () => {
    const result = await startLlamaServer(
      withConfig({
        model: "missing.gguf",
        llamaServerPath: "/bin/true",
        llamaModelsDir: "/tmp/yips-not-real-model-dir"
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("model-not-found");
  });

  it("returns process-exited when spawned binary exits immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true"
      }),
      {
        inspectPortOwner: vi.fn().mockResolvedValue(null)
      }
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("process-exited");
    await rm(root, { recursive: true, force: true });
  });

  it("returns port-unavailable when policy is fail and port is occupied", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const inspectPortOwner = vi.fn().mockResolvedValue({
      pid: 444,
      uid: 1000,
      command: "python -m http.server"
    });

    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true",
        llamaPortConflictPolicy: "fail"
      }),
      {
        inspectPortOwner
      }
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("port-unavailable");
    expect(result.failure?.conflictPid).toBe(444);
    expect(result.failure?.conflictCommand).toContain("http.server");
    await rm(root, { recursive: true, force: true });
  });

  it("kills user-owned process when policy is kill-user", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const inspectPortOwner = vi
      .fn()
      .mockResolvedValueOnce({ pid: 555, uid: 1000, command: "python -m http.server" })
      .mockResolvedValueOnce(null);
    const sendSignal = vi.fn();
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { process: child } = createMockProcess(null);

    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true",
        llamaPortConflictPolicy: "kill-user"
      }),
      {
        inspectPortOwner,
        sendSignal,
        currentUid: () => 1000,
        isPidRunning: () => false,
        checkHealth,
        spawnProcess: vi.fn().mockReturnValue(child)
      }
    );

    expect(result.started).toBe(true);
    expect(sendSignal).toHaveBeenCalledWith(555, "SIGTERM");
    await rm(root, { recursive: true, force: true });
  });

  it("does not kill non-user process when policy is kill-user", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const sendSignal = vi.fn();
    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true",
        llamaPortConflictPolicy: "kill-user"
      }),
      {
        inspectPortOwner: vi.fn().mockResolvedValue({
          pid: 666,
          uid: 999,
          command: "python -m http.server"
        }),
        sendSignal,
        currentUid: () => 1000
      }
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("port-unavailable");
    expect(sendSignal).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });

  it("classifies bind stderr as port-unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const { process: child, stderr } = createMockProcess(null);
    const spawnProcess = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        stderr.write("start: couldn't bind HTTP server socket\n");
        child.exitCode = 1;
      });
      return child;
    });

    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true"
      }),
      {
        inspectPortOwner: vi.fn().mockResolvedValue(null),
        spawnProcess,
        checkHealth: vi.fn().mockResolvedValue(false)
      }
    );

    expect(result.started).toBe(false);
    expect(result.failure?.kind).toBe("port-unavailable");
    expect(result.failure?.details.join("\n")).toContain("couldn't bind");
    await rm(root, { recursive: true, force: true });
  });

  it("warns and forces -ngl 0 when GPU layers are requested but no devices are found", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const { process: child } = createMockProcess(null);
    const spawnProcess = vi.fn().mockReturnValue(child);
    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true",
        llamaGpuLayers: 999
      }),
      {
        inspectPortOwner: vi.fn().mockResolvedValue(null),
        checkHealth: vi.fn().mockResolvedValue(true),
        spawnProcess,
        listDevices: vi.fn().mockReturnValue(0)
      }
    );

    expect(result.started).toBe(true);
    expect(result.warnings?.[0]).toContain("Running CPU-only (-ngl 0)");
    const args = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).toContain("-ngl");
    const nglIndex = args.indexOf("-ngl");
    expect(args[nglIndex + 1]).toBe("0");
    await rm(root, { recursive: true, force: true });
  });

  it("keeps configured gpu layers when devices are available", async () => {
    const root = await mkdtemp(join(tmpdir(), "yips-llama-model-"));
    const modelPath = join(root, "model.gguf");
    await writeFile(modelPath, "binary", "utf8");

    const { process: child } = createMockProcess(null);
    const spawnProcess = vi.fn().mockReturnValue(child);
    const result = await startLlamaServer(
      withConfig({
        model: modelPath,
        llamaServerPath: "/bin/true",
        llamaGpuLayers: 77
      }),
      {
        inspectPortOwner: vi.fn().mockResolvedValue(null),
        checkHealth: vi.fn().mockResolvedValue(true),
        spawnProcess,
        listDevices: vi.fn().mockReturnValue(1)
      }
    );

    expect(result.started).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const args = spawnProcess.mock.calls[0]?.[1] as string[];
    const nglIndex = args.indexOf("-ngl");
    expect(args[nglIndex + 1]).toBe("77");
    await rm(root, { recursive: true, force: true });
  });
});

describe("parseLlamaDeviceCount", () => {
  it("returns 0 for header-only output", () => {
    expect(parseLlamaDeviceCount("Available devices:\n")).toBe(0);
  });

  it("counts non-empty device lines", () => {
    const output = ["Available devices:", "CUDA0: NVIDIA GeForce RTX 3080", ""].join("\n");
    expect(parseLlamaDeviceCount(output)).toBe(1);
  });
});

describe("formatLlamaStartupFailure", () => {
  it("includes commands and context lines", () => {
    const formatted = formatLlamaStartupFailure(
      {
        kind: "model-not-found",
        message: "Could not resolve model.",
        details: ["Checked: /tmp/models"],
        host: "127.0.0.1",
        port: 8080,
        conflictPid: 777,
        conflictCommand: "python -m http.server"
      },
      withConfig({
        model: "qwen.gguf",
        llamaModelsDir: "/tmp/models"
      })
    );

    expect(formatted).toContain("Could not resolve model.");
    expect(formatted).toContain("Endpoint: 127.0.0.1:8080");
    expect(formatted).toContain("Conflict: PID 777");
    expect(formatted).toContain("which llama-server");
    expect(formatted).toContain("ls /tmp/models/qwen.gguf");
  });
});

describe("isLocalLlamaEndpoint", () => {
  it("returns true for localhost and loopback hosts", () => {
    expect(isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "http://localhost:8080" }))).toBe(true);
    expect(isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "http://127.0.0.1:8080" }))).toBe(true);
    expect(isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "http://127.0.2.1:8080" }))).toBe(true);
    expect(isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "http://[::1]:8080" }))).toBe(true);
  });

  it("returns false for non-local hosts", () => {
    expect(isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "http://10.0.0.4:8080" }))).toBe(false);
    expect(
      isLocalLlamaEndpoint(withConfig({ llamaBaseUrl: "https://models.example.com:443" }))
    ).toBe(false);
  });
});

describe("resetLlamaForFreshSession", () => {
  it("is a no-op for non-local endpoints", async () => {
    const result = await resetLlamaForFreshSession(
      withConfig({
        llamaBaseUrl: "https://models.example.com:443",
        llamaServerPath: "/definitely/missing",
        model: "missing.gguf"
      })
    );

    expect(result).toEqual({ started: false });
  });

  it("propagates startup failure for localhost endpoints", async () => {
    const result = await resetLlamaForFreshSession(
      withConfig({
        llamaBaseUrl: "http://127.0.0.1:8080",
        llamaServerPath: "/definitely/missing",
        model: "missing.gguf"
      })
    );

    expect(result.started).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.failure?.kind).not.toBe("port-unavailable");
  });
});
