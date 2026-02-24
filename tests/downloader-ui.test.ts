import { describe, expect, it } from "vitest";

import { stripAnsi } from "../src/colors";
import {
  createDownloaderState,
  setFiles,
  setLoadingFiles,
  setLoadingModels,
  setModels,
  startDownload,
  updateDownloadProgress
} from "../src/downloader-state";
import { renderDownloaderLines } from "../src/downloader-ui";

describe("downloader-ui", () => {
  it("renders model list mode with title and controls", () => {
    const state = setModels(createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }), [
      {
        id: "org/model",
        downloads: 1000,
        likes: 50,
        lastModified: "2026-01-01T00:00:00.000Z",
        sizeBytes: 1_000_000_000,
        canRun: true,
        reason: "Fits RAM+VRAM"
      }
    ]);

    const lines = renderDownloaderLines({ width: 100, state });
    const plain = lines.map((line) => stripAnsi(line));

    expect(plain.some((line) => line.includes("Yips Model Downloader"))).toBe(true);
    expect(plain.some((line) => line.includes("Most Downloaded"))).toBe(true);
    expect(plain.some((line) => line.includes("org/model"))).toBe(true);
    expect(plain.some((line) => line.includes("[Enter] Select"))).toBe(true);
    expect(lines.some((line) => line.includes("\u001b[48;2;"))).toBe(true);
  });

  it("renders file mode instructions and status colors", () => {
    const base = createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 });
    const state = setFiles(base, "org/model", [
      {
        path: "model-q4.gguf",
        sizeBytes: 2_000_000_000,
        quant: "Q4_K_M (Balanced)",
        canRun: true,
        reason: "Fits RAM+VRAM"
      },
      {
        path: "model-q8.gguf",
        sizeBytes: 20_000_000_000,
        quant: "Q8_0 (Max Quality)",
        canRun: false,
        reason: "Model too large"
      }
    ]);

    const lines = renderDownloaderLines({ width: 100, state });
    const plain = lines.map((line) => stripAnsi(line));

    expect(plain.some((line) => line.includes("Files for org/model"))).toBe(true);
    expect(plain.some((line) => line.includes("model-q4.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("model-q8.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("[Enter] Download"))).toBe(true);
    expect(lines.some((line) => line.includes("\u001b[38;2;255;68;68m"))).toBe(true);
  });

  it("keeps downloader frame height stable across file states", () => {
    const base = setFiles(
      createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }),
      "org/model",
      [
        {
          path: "model-q4.gguf",
          sizeBytes: 2_000_000_000,
          quant: "Q4_K_M (Balanced)",
          canRun: true,
          reason: "Fits RAM+VRAM"
        }
      ]
    );
    const loading = setLoadingFiles(base, "Loading files...");
    const downloading = startDownload(base, "org/model", "model-q4.gguf", "Downloading...");

    const baseLines = renderDownloaderLines({ width: 100, state: base });
    const loadingLines = renderDownloaderLines({ width: 100, state: loading });
    const downloadingLines = renderDownloaderLines({ width: 100, state: downloading });

    expect(baseLines).toHaveLength(14);
    expect(loadingLines).toHaveLength(14);
    expect(downloadingLines).toHaveLength(5);
  });

  it("renders downloading progress bar and status line", () => {
    const base = setFiles(
      createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }),
      "org/model",
      [
        {
          path: "nested/path/model-q4.gguf",
          sizeBytes: 2_000_000_000,
          quant: "Q4_K_M (Balanced)",
          canRun: true,
          reason: "Fits RAM+VRAM"
        }
      ]
    );
    const started = startDownload(base, "org/model", "nested/path/model-q4.gguf", "Downloading...");
    const progressed = updateDownloadProgress(started, {
      bytesDownloaded: 1024,
      totalBytes: 2048,
      statusText: "1.0 KB / 2.0 KB • 1.0 KB/s • ETA 00:01"
    });

    const plain = renderDownloaderLines({ width: 100, state: progressed }).map((line) =>
      stripAnsi(line)
    );
    expect(plain.some((line) => line.includes("Downloading model-q4.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("[") && line.includes("%"))).toBe(true);
    expect(plain.some((line) => line.includes("ETA 00:01"))).toBe(true);
    expect(plain.some((line) => line.includes("Most Downloaded"))).toBe(false);
    expect(plain.some((line) => line.includes("[Esc] Cancel"))).toBe(true);
    const progressLine = plain.find((line) => line.includes("[") && line.includes("%")) ?? "";
    expect(progressLine.endsWith("%│")).toBe(true);
    const emptyLines = plain.filter((line) => /^│\s*│$/u.test(line));
    expect(emptyLines).toHaveLength(0);
  });

  it("renders bordered blank body rows while loading", () => {
    const state = setLoadingModels(
      createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }),
      "Loading models from Hugging Face..."
    );
    const plainLines = renderDownloaderLines({ width: 100, state }).map((line) => stripAnsi(line));
    const bodyRows = plainLines.slice(2, 12);
    expect(bodyRows.every((line) => line.startsWith("│") && line.endsWith("│"))).toBe(true);
  });
});
