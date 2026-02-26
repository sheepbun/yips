import { createHash, randomUUID } from "node:crypto";

export type FileChangeOperation = "write_file" | "edit_file";

export interface FileChangePreview {
  token: string;
  operation: FileChangeOperation;
  absolutePath: string;
  before: string;
  after: string;
  diffPreview: string;
  createdAt: string;
  expiresAt: string;
  contentHashBefore: string;
}

export interface FileChangeStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50;

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class FileChangeStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly previews = new Map<string, FileChangePreview>();

  constructor(options: FileChangeStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  createPreview(input: {
    operation: FileChangeOperation;
    absolutePath: string;
    before: string;
    after: string;
    diffPreview: string;
  }): FileChangePreview {
    this.cleanupExpired();
    const now = Date.now();
    const preview: FileChangePreview = {
      token: randomUUID(),
      operation: input.operation,
      absolutePath: input.absolutePath,
      before: input.before,
      after: input.after,
      diffPreview: input.diffPreview,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      contentHashBefore: hashContent(input.before)
    };
    this.previews.set(preview.token, preview);
    this.enforceMaxEntries();
    return preview;
  }

  get(token: string): FileChangePreview | null {
    this.cleanupExpired();
    return this.previews.get(token) ?? null;
  }

  consume(token: string): FileChangePreview | null {
    this.cleanupExpired();
    const preview = this.previews.get(token) ?? null;
    if (!preview) {
      return null;
    }
    this.previews.delete(token);
    return preview;
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const [token, preview] of this.previews.entries()) {
      if (Date.parse(preview.expiresAt) <= now) {
        this.previews.delete(token);
      }
    }
  }

  static hashContent(text: string): string {
    return hashContent(text);
  }

  private enforceMaxEntries(): void {
    while (this.previews.size > this.maxEntries) {
      const first = this.previews.keys().next();
      if (first.done) {
        return;
      }
      this.previews.delete(first.value);
    }
  }
}
