import { describe, expect, it } from "vitest";

import {
  closeCancelConfirm,
  DOWNLOADER_TABS,
  closeFileView,
  createDownloaderState,
  cycleTab,
  finishDownload,
  getCachedModels,
  moveFileSelection,
  moveModelSelection,
  openCancelConfirm,
  resetModelCache,
  setCachedModels,
  setDownloaderError,
  setFiles,
  setLoadingFiles,
  setLoadingModels,
  setModels,
  startDownload,
  tabToSort,
  updateDownloadProgress
} from "../src/downloader-state";

describe("downloader-state", () => {
  it("maps tabs to sort keys", () => {
    expect(tabToSort("Most Downloaded")).toBe("downloads");
    expect(tabToSort("Top Rated")).toBe("trendingScore");
    expect(tabToSort("Newest")).toBe("lastModified");
  });

  it("cycles tabs and resets selection", () => {
    const state = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const next = cycleTab({ ...state, selectedModelIndex: 4 }, 1);
    expect(next.tab).toBe("Top Rated");
    expect(next.selectedModelIndex).toBe(0);
  });

  it("exposes the expected tab ordering", () => {
    expect(DOWNLOADER_TABS).toEqual(["Most Downloaded", "Top Rated", "Newest"]);
  });

  it("caches models by tab and query", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const cached = setCachedModels(base, "Top Rated", "qwen", [
      {
        id: "repo/qwen",
        downloads: 1,
        likes: 2,
        lastModified: "2026-01-01",
        sizeBytes: 1,
        canRun: true,
        reason: "ok"
      }
    ]);

    expect(getCachedModels(cached, "Top Rated", "qwen")).toHaveLength(1);
    expect(getCachedModels(cached, "Most Downloaded", "qwen")).toBeNull();
    expect(getCachedModels(cached, "Top Rated", "llama")).toBeNull();
  });

  it("resets cache for a new query", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const cached = setCachedModels(base, "Most Downloaded", "", [
      {
        id: "repo/a",
        downloads: 1,
        likes: 1,
        lastModified: "2026-01-01",
        sizeBytes: 1,
        canRun: true,
        reason: "ok"
      }
    ]);
    const reset = resetModelCache(cached, "qwen");
    expect(getCachedModels(reset, "Most Downloaded", "qwen")).toBeNull();
  });

  it("moves model and file selection with scrolling", () => {
    const withModels = setModels(
      createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 }),
      Array.from({ length: 20 }).map((_, index) => ({
        id: `repo/${index}`,
        downloads: index,
        likes: index,
        lastModified: "2026-01-01",
        sizeBytes: 1,
        canRun: true,
        reason: "ok"
      }))
    );

    const down = moveModelSelection(withModels, 1, 10);
    expect(down.selectedModelIndex).toBe(1);

    const fileState = setFiles(withModels, "repo/x", [
      { path: "a.gguf", sizeBytes: 1, quant: "Q4", canRun: true, reason: "ok" },
      { path: "b.gguf", sizeBytes: 1, quant: "Q4", canRun: true, reason: "ok" }
    ]);

    const nextFile = moveFileSelection(fileState, 1, 9);
    expect(nextFile.selectedFileIndex).toBe(1);
  });

  it("closes file view back to model view", () => {
    const state = setFiles(
      createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 }),
      "repo/x",
      [{ path: "a.gguf", sizeBytes: 1, quant: "Q4", canRun: true, reason: "ok" }]
    );
    const closed = closeFileView(state);
    expect(closed.view).toBe("models");
    expect(closed.files).toHaveLength(0);
  });

  it("tracks downloader phase transitions", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const loadingModels = setLoadingModels(base, "Loading models...");
    expect(loadingModels.phase).toBe("loading-models");
    expect(loadingModels.loading).toBe(true);

    const loadingFiles = setLoadingFiles(loadingModels, "Loading files...");
    expect(loadingFiles.phase).toBe("loading-files");

    const downloading = startDownload(loadingFiles, "repo/a", "model.gguf", "Starting download...");
    expect(downloading.phase).toBe("downloading");
    expect(downloading.download?.filename).toBe("model.gguf");
    expect(downloading.cancelConfirmOpen).toBe(false);

    const finished = finishDownload(downloading);
    expect(finished.phase).toBe("idle");
    expect(finished.loading).toBe(false);
    expect(finished.download).toBeNull();
    expect(finished.cancelConfirmOpen).toBe(false);
  });

  it("moves to error phase from active states", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const downloading = startDownload(base, "repo/a", "model.gguf", "Downloading...");
    const errored = setDownloaderError(downloading, "Network failed");
    expect(errored.phase).toBe("error");
    expect(errored.loading).toBe(false);
    expect(errored.errorMessage).toBe("Network failed");
    expect(errored.download).toBeNull();
  });

  it("updates download progress details", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const downloading = startDownload(base, "repo/a", "model.gguf", "Downloading...");
    const next = updateDownloadProgress(downloading, {
      bytesDownloaded: 1024,
      totalBytes: 2048,
      statusText: "1.0 KB / 2.0 KB • 1.0 KB/s • ETA 00:01"
    });
    expect(next.download?.bytesDownloaded).toBe(1024);
    expect(next.download?.totalBytes).toBe(2048);
    expect(next.loadingMessage).toContain("ETA");
  });

  it("opens and closes cancel confirmation while downloading", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const downloading = startDownload(base, "repo/a", "model.gguf", "Downloading...");
    const opened = openCancelConfirm(downloading);
    expect(opened.cancelConfirmOpen).toBe(true);

    const closed = closeCancelConfirm(opened);
    expect(closed.cancelConfirmOpen).toBe(false);
  });

  it("does not open cancel confirmation outside downloading phase", () => {
    const base = createDownloaderState({ ramGb: 8, vramGb: 8, totalMemoryGb: 16 });
    const next = openCancelConfirm(base);
    expect(next.cancelConfirmOpen).toBe(false);
  });
});
