import type { ChatMessage } from "./types";

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

interface ChatCompletionRequest {
  model: string;
  messages: readonly ChatMessage[];
  stream: boolean;
}

interface StreamLineResult {
  done: boolean;
  token: string;
}

export interface StreamChatHandlers {
  onToken: (token: string) => void;
}

export interface LlamaClientOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractFirstChoice(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  return isRecord(first) ? first : null;
}

function extractMessageContent(choice: Record<string, unknown>): string {
  const message = choice["message"];
  if (isRecord(message) && typeof message["content"] === "string") {
    return message["content"];
  }

  return "";
}

function extractDeltaContent(choice: Record<string, unknown>): string {
  const delta = choice["delta"];
  if (isRecord(delta) && typeof delta["content"] === "string") {
    return delta["content"];
  }

  return "";
}

function parseStreamLine(line: string): StreamLineResult {
  if (!line.startsWith("data:")) {
    return { done: false, token: "" };
  }

  const payload = line.slice("data:".length).trim();
  if (payload.length === 0) {
    return { done: false, token: "" };
  }

  if (payload === "[DONE]") {
    return { done: true, token: "" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`Failed to parse streaming payload: ${payload.slice(0, 200)}`);
  }

  const choice = extractFirstChoice(parsed);
  if (!choice) {
    return { done: false, token: "" };
  }

  const token = extractDeltaContent(choice) || extractMessageContent(choice);
  return { done: false, token };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

export class LlamaClient {
  private readonly baseUrl: string;
  private model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LlamaClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  setModel(model: string): void {
    const next = model.trim();
    if (next.length > 0) {
      this.model = next;
    }
  }

  getModel(): string {
    return this.model;
  }

  async chat(messages: readonly ChatMessage[], model = this.model): Promise<string> {
    const payload = this.buildPayload(messages, model, false);
    const response = await this.requestCompletion(payload);

    const parsed: unknown = await response.json();
    const choice = extractFirstChoice(parsed);
    if (!choice) {
      throw new Error("Chat completion response did not include choices.");
    }

    const content = extractMessageContent(choice);
    if (content.length === 0) {
      throw new Error("Chat completion response did not include assistant content.");
    }

    return content;
  }

  async streamChat(
    messages: readonly ChatMessage[],
    handlers: StreamChatHandlers,
    model = this.model
  ): Promise<string> {
    const payload = this.buildPayload(messages, model, true);
    const response = await this.requestCompletion(payload);
    if (!response.body) {
      throw new Error("Streaming response body is unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let streamDone = false;

    try {
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const result = parseStreamLine(line.trim());
          if (result.token.length > 0) {
            content += result.token;
            handlers.onToken(result.token);
          }
          if (result.done) {
            streamDone = true;
            break;
          }
        }
      }

      const finalChunk = decoder.decode();
      if (finalChunk.length > 0) {
        buffer += finalChunk;
      }

      if (!streamDone && buffer.trim().length > 0) {
        const result = parseStreamLine(buffer.trim());
        if (result.token.length > 0) {
          content += result.token;
          handlers.onToken(result.token);
        }
      }

      return content;
    } finally {
      reader.releaseLock();
    }
  }

  private buildPayload(
    messages: readonly ChatMessage[],
    model: string,
    stream: boolean
  ): ChatCompletionRequest {
    return {
      model: model.trim() || this.model,
      messages,
      stream
    };
  }

  private async requestCompletion(payload: ChatCompletionRequest): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const endpoint = `${this.baseUrl}${CHAT_COMPLETIONS_PATH}`;
    let response: Response;

    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`llama.cpp request timed out after ${this.timeoutMs}ms.`);
      }

      throw new Error(
        `Failed to connect to llama.cpp at ${this.baseUrl}: ${toErrorMessage(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await readErrorBody(response);
      const suffix = details.length > 0 ? `: ${details}` : "";
      throw new Error(
        `llama.cpp request failed (${response.status} ${response.statusText})${suffix}`
      );
    }

    return response;
  }
}
