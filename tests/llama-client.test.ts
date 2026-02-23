import { describe, expect, it, vi } from "vitest";

import { LlamaClient } from "../src/llama-client";
import type { ChatMessage } from "../src/types";

const TEST_MESSAGES: ChatMessage[] = [{ role: "user", content: "hello" }];

function createJsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createSseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}

describe("LlamaClient.chat", () => {
  it("posts chat completions and returns assistant text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: "assistant", content: "Hi from llama.cpp" } }]
      })
    );
    const client = new LlamaClient({
      baseUrl: "http://127.0.0.1:8080/",
      model: "qwen3",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const text = await client.chat(TEST_MESSAGES);

    expect(text).toBe("Hi from llama.cpp");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });

    const body = JSON.parse(String(init.body)) as { model: string; stream: boolean };
    expect(body.model).toBe("qwen3");
    expect(body.stream).toBe(false);
  });

  it("includes non-OK response details in thrown errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("backend unavailable", { status: 503, statusText: "Service Unavailable" })
      );
    const client = new LlamaClient({
      baseUrl: "http://localhost:8080",
      model: "qwen3",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await expect(client.chat(TEST_MESSAGES)).rejects.toThrow(
      "llama.cpp request failed (503 Service Unavailable): backend unavailable"
    );
  });

  it("maps AbortError to timeout failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const client = new LlamaClient({
      baseUrl: "http://localhost:8080",
      model: "qwen3",
      timeoutMs: 50,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await expect(client.chat(TEST_MESSAGES)).rejects.toThrow("timed out after 50ms");
  });
});

describe("LlamaClient.streamChat", () => {
  it("streams SSE deltas and returns concatenated text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          "data: [DONE]\n\n"
        ])
      );
    const client = new LlamaClient({
      baseUrl: "http://localhost:8080",
      model: "qwen3",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const tokens: string[] = [];

    const text = await client.streamChat(TEST_MESSAGES, {
      onToken: (token) => {
        tokens.push(token);
      }
    });

    expect(text).toBe("Hello");
    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("throws when streaming payload is malformed JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createSseResponse(["data: {not json}\n\n", "data: [DONE]\n\n"]));
    const client = new LlamaClient({
      baseUrl: "http://localhost:8080",
      model: "qwen3",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await expect(
      client.streamChat(TEST_MESSAGES, {
        onToken: () => undefined
      })
    ).rejects.toThrow("Failed to parse streaming payload");
  });
});
