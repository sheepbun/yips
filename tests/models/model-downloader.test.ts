import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  downloadModelFile,
  isHfDownloadUrl,
  listGgufModels,
  listModelFiles,
  parseHfDownloadUrl,
  renderFileList,
  renderModelList
} from "#models/model-downloader";

describe("model-downloader", () => {
  it("lists GGUF models and filters oversized entries by RAM+VRAM heuristic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "repo/a",
            downloads: 1200,
            likes: 33,
            lastModified: "2026-01-01T00:00:00.000Z",
            gguf: { total: 2 * 1024 ** 3 }
          },
          {
            id: "repo/b",
            downloads: 500,
            likes: 4,
            lastModified: "2026-01-03T00:00:00.000Z",
            gguf: { total: 16 * 1024 ** 3 }
          }
        ]),
        { status: 200 }
      )
    );

    const models = await listGgufModels({
      query: "qwen",
      totalMemoryGb: 8,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: "repo/a", downloads: 1200, likes: 33, canRun: true });
  });

  it("retries model listing without expand params after HTTP 400", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("bad request", { status: 400, statusText: "Bad Request" })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "repo/fallback",
              downloads: 10,
              likes: 2,
              lastModified: "2026-01-01T00:00:00.000Z"
            }
          ]),
          { status: 200 }
        )
      );

    const models = await listGgufModels({ fetchImpl: fetchMock as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(models[0]?.id).toBe("repo/fallback");
  });

  it("lists GGUF files, annotates quant, and marks oversized files as incompatible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          siblings: [
            { rfilename: "model-Q5_K_M.gguf", size: 3_000_000_000 },
            { rfilename: "big-Q8_0.gguf", size: 12_000_000_000 },
            { rfilename: "README.md" }
          ]
        }),
        { status: 200 }
      )
    );

    const files = await listModelFiles("repo/a", {
      totalMemoryGb: 8,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("model-Q5_K_M.gguf");
    expect(files[0]?.quant).toContain("Q5_K_M");
    expect(files[1]?.path).toBe("big-Q8_0.gguf");
    expect(files[1]?.canRun).toBe(false);
  });

  it("parses and validates huggingface direct download URLs", () => {
    expect(parseHfDownloadUrl("https://hf.co/org/model/resolve/main/path/model-q4.gguf")).toEqual({
      repoId: "org/model",
      revision: "main",
      filename: "path/model-q4.gguf"
    });

    expect(isHfDownloadUrl("https://huggingface.co/org/model/resolve/dev/model.gguf")).toBe(true);
    expect(() => parseHfDownloadUrl("https://example.com/org/model.gguf")).toThrow();
    expect(isHfDownloadUrl("https://hf.co/org/model/resolve/main/model.safetensors")).toBe(false);
  });

  it("downloads a model file into models directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "yips-download-"));
    const payload = new TextEncoder().encode("gguf-binary-data");
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(payload);
        controller.close();
      }
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength)
        }
      })
    );
    const onProgress = vi.fn();

    try {
      const result = await downloadModelFile({
        repoId: "repo/a",
        filename: "model-q4.gguf",
        revision: "main",
        modelsDir: tempRoot,
        fetchImpl: fetchMock as typeof fetch,
        onProgress
      });

      const content = await readFile(result.localPath, "utf8");
      expect(content).toBe("gguf-binary-data");
      expect(result.localPath).toContain(join("repo", "a", "model-q4.gguf"));
      expect(result.byteCount).toBe(payload.byteLength);
      expect(onProgress).toHaveBeenCalled();
      const lastEvent = onProgress.mock.calls.at(-1)?.[0] as
        | { bytesDownloaded: number; totalBytes: number | null }
        | undefined;
      expect(lastEvent).toEqual({
        bytesDownloaded: payload.byteLength,
        totalBytes: payload.byteLength
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports unknown total size when content-length is missing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "yips-download-"));
    const payload = new TextEncoder().encode("small-data");
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(payload);
        controller.close();
      }
    });
    const onProgress = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      })
    );

    try {
      await downloadModelFile({
        repoId: "repo/a",
        filename: "model-q4.gguf",
        modelsDir: tempRoot,
        fetchImpl: fetchMock as typeof fetch,
        onProgress
      });
      const lastEvent = onProgress.mock.calls.at(-1)?.[0] as
        | { bytesDownloaded: number; totalBytes: number | null }
        | undefined;
      expect(lastEvent?.bytesDownloaded).toBe(payload.byteLength);
      expect(lastEvent?.totalBytes).toBeNull();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("deletes partial file when download stream fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "yips-download-"));
    const firstChunk = new TextEncoder().encode("partial-data");
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(firstChunk);
        controller.error(new Error("stream failure"));
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      })
    );
    const outputPath = join(tempRoot, "repo", "a", "model-q4.gguf");

    try {
      await expect(
        downloadModelFile({
          repoId: "repo/a",
          filename: "model-q4.gguf",
          modelsDir: tempRoot,
          fetchImpl: fetchMock as typeof fetch
        })
      ).rejects.toThrow();

      await expect(stat(outputPath)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("renders model and file lists", () => {
    const modelsText = renderModelList([
      {
        id: "repo/a",
        downloads: 1000,
        likes: 42,
        lastModified: "2026-01-01T00:00:00.000Z",
        sizeBytes: 1_000,
        canRun: true,
        reason: "Fits RAM+VRAM"
      }
    ]);
    expect(modelsText).toContain("repo/a");

    const filesText = renderFileList([
      { path: "model.gguf", sizeBytes: 123, quant: "Q4_K_M", canRun: true, reason: "OK" }
    ]);
    expect(filesText).toContain("model.gguf");
  });
});
