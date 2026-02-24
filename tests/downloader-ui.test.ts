import { describe, expect, it } from "vitest";

import { GRADIENT_BLUE, GRADIENT_PINK, stripAnsi } from "../src/colors";
import {
  createDownloaderState,
  openCancelConfirm,
  setFiles,
  setLoadingFiles,
  setLoadingModels,
  setModels,
  startDownload,
  updateDownloadProgress
} from "../src/downloader-state";
import { renderDownloaderLines } from "../src/downloader-ui";

function stripFrame(line: string): string {
  const plain = stripAnsi(line);
  if (!plain.startsWith("│") || !plain.endsWith("│")) {
    return plain;
  }
  return plain.slice(1, -1);
}

function pipeIndexes(line: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|") {
      result.push(i);
    }
  }
  return result;
}

function colorCodeBeforeColumn(markupLine: string, plainColumn: number): string {
  let plainCount = 0;
  let activeColor = "";

  for (let i = 0; i < markupLine.length; i++) {
    const char = markupLine[i] ?? "";
    if (char === "\u001b" && markupLine[i + 1] === "[") {
      const endIndex = markupLine.indexOf("m", i);
      if (endIndex >= 0) {
        if (markupLine.startsWith("\u001b[38;2;", i)) {
          activeColor = markupLine.slice(i, endIndex + 1);
        }
        i = endIndex;
      }
      continue;
    }

    if (plainCount === plainColumn) {
      return activeColor;
    }
    plainCount += 1;
  }

  return activeColor;
}

function toAnsiForeground(color: { r: number; g: number; b: number }): string {
  return `\u001b[38;2;${Math.round(color.r)};${Math.round(color.g)};${Math.round(color.b)}m`;
}

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
    expect(plain.some((line) => line.includes("RAM: 16.0GB"))).toBe(true);
    expect(plain.some((line) => line.includes("VRAM: 8.0GB"))).toBe(true);
    expect(plain.some((line) => line.includes("RAM+VRAM"))).toBe(false);
    expect(lines.some((line) => line.includes("\u001b[48;2;"))).toBe(true);
    expect(lines[0]).toContain("\u001b[1m");
    expect(lines[0]).toContain(toAnsiForeground(GRADIENT_BLUE));

    const tabsLine = lines.find((line) => stripAnsi(line).includes("Most Downloaded")) ?? "";
    expect(tabsLine).toContain("\u001b[1m");

    const footerLine = lines.find((line) => stripAnsi(line).includes("[Enter] Select")) ?? "";
    const footerColorRuns = Math.max(0, footerLine.split("38;2;").length - 1);
    expect(footerColorRuns).toBeGreaterThan(4);
  });

  it("renders model details in aligned columns with a header", () => {
    const state = setModels(createDownloaderState({ ramGb: 16, vramGb: 8, totalMemoryGb: 24 }), [
      {
        id: "org/model-alpha",
        downloads: 12_300,
        likes: 540,
        lastModified: "2026-01-21T00:00:00.000Z",
        sizeBytes: 11_000_000_000,
        canRun: true,
        reason: "Fits RAM+VRAM"
      },
      {
        id: "org/model-beta",
        downloads: 900,
        likes: 12,
        lastModified: "2025-12-11T00:00:00.000Z",
        sizeBytes: 6_000_000_000,
        canRun: true,
        reason: "Fits RAM+VRAM"
      }
    ]);

    const plainLines = renderDownloaderLines({ width: 100, state }).map((line) => stripAnsi(line));
    const headerLine = plainLines.find(
      (line) => line.includes("Model") && line.includes("Downloads") && line.includes("Updated")
    );
    expect(headerLine).toBeDefined();
    const headerMarkupLine =
      renderDownloaderLines({ width: 100, state }).find(
        (line) =>
          stripAnsi(line).includes("Model") &&
          stripAnsi(line).includes("Downloads") &&
          stripAnsi(line).includes("Updated")
      ) ?? "";
    const headerColorRuns = Math.max(0, headerMarkupLine.split("38;2;").length - 1);
    expect(headerColorRuns).toBeGreaterThan(4);

    const modelLine = plainLines.find((line) => line.includes("org/model-alpha"));
    expect(modelLine).toBeDefined();
    expect(modelLine).toContain("12.3k↓");
    expect(modelLine).toContain("540♥");

    const innerHeader = stripFrame(headerLine ?? "");
    const innerModel = stripFrame(modelLine ?? "");
    expect(pipeIndexes(innerHeader)).toEqual(pipeIndexes(innerModel));
  });

  it("keeps a standalone title gradient while border continues outside it", () => {
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
    const topLine = lines[0] ?? "";
    const topPlain = stripAnsi(topLine);
    const titleStart = topPlain.indexOf("Yips Model Downloader");

    expect(titleStart).toBeGreaterThan(0);
    const afterTitle = titleStart + "Yips Model Downloader".length + 1;

    expect(colorCodeBeforeColumn(topLine, 0)).toBe(toAnsiForeground(GRADIENT_PINK));
    expect(colorCodeBeforeColumn(topLine, titleStart)).toBe(toAnsiForeground(GRADIENT_PINK));
    expect(colorCodeBeforeColumn(topLine, afterTitle)).not.toBe(toAnsiForeground(GRADIENT_PINK));
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
    const filesHeaderLine = plain.find(
      (line) => line.includes("File") && line.includes("Quant") && line.includes("Size") && line.includes("Fit")
    );
    expect(filesHeaderLine).toBeDefined();
    const fileRowLine = plain.find((line) => line.includes("model-q4.gguf"));
    expect(fileRowLine).toBeDefined();
    expect(pipeIndexes(stripFrame(filesHeaderLine ?? ""))).toEqual(pipeIndexes(stripFrame(fileRowLine ?? "")));
    expect(plain.some((line) => line.includes("model-q4.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("model-q8.gguf"))).toBe(true);
    expect(plain.some((line) => line.includes("Fits on GPU"))).toBe(true);
    expect(plain.some((line) => line.includes("Model too large"))).toBe(true);
    expect(plain.some((line) => line.includes("[Enter] Download"))).toBe(true);
    const fileFooterLine = lines.find((line) => stripAnsi(line).includes("[Enter] Download")) ?? "";
    const fileFooterColorRuns = Math.max(0, fileFooterLine.split("38;2;").length - 1);
    expect(fileFooterColorRuns).toBeGreaterThan(4);
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
    const footerLine =
      renderDownloaderLines({ width: 100, state: progressed }).find((line) =>
        stripAnsi(line).includes("[Esc] Cancel")
      ) ?? "";
    const footerColorRuns = Math.max(0, footerLine.split("38;2;").length - 1);
    expect(footerColorRuns).toBeGreaterThan(4);
    const progressLine = plain.find((line) => line.includes("[") && line.includes("%")) ?? "";
    expect(progressLine.endsWith("%│")).toBe(true);
    const emptyLines = plain.filter((line) => /^│\s*│$/u.test(line));
    expect(emptyLines).toHaveLength(0);
  });

  it("renders cancel confirmation popup while download is active", () => {
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
    const downloading = startDownload(base, "org/model", "model-q4.gguf", "Downloading...");
    const confirming = openCancelConfirm(downloading);
    const plain = renderDownloaderLines({ width: 100, state: confirming }).map((line) =>
      stripAnsi(line)
    );

    expect(plain.some((line) => line.includes("Cancel download and delete partial file?"))).toBe(true);
    expect(plain.some((line) => line.includes("[Enter] Yes  [Esc] No"))).toBe(true);
    const footerLine = renderDownloaderLines({ width: 100, state: confirming }).find((line) =>
      stripAnsi(line).includes("[Enter] Yes  [Esc] No")
    );
    const footerColorRuns = Math.max(0, (footerLine ?? "").split("38;2;").length - 1);
    expect(footerColorRuns).toBeGreaterThan(4);
    expect(plain).toHaveLength(5);
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
