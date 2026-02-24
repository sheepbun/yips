export type Backend = "llamacpp" | "claude";
export type LlamaPortConflictPolicy = "fail" | "kill-llama" | "kill-user";

export interface AppConfig {
  streaming: boolean;
  verbose: boolean;
  backend: Backend;
  llamaBaseUrl: string;
  llamaServerPath: string;
  llamaModelsDir: string;
  llamaHost: string;
  llamaPort: number;
  llamaContextSize: number;
  llamaGpuLayers: number;
  llamaAutoStart: boolean;
  llamaPortConflictPolicy: LlamaPortConflictPolicy;
  model: string;
  tokensMode: "auto" | "manual";
  tokensManualMax: number;
  nicknames: Record<string, string>;
}

export interface SessionState {
  messageCount: number;
  running: boolean;
  config: AppConfig;
}

export interface ReplOptions {
  config: AppConfig;
  prompt?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export type ReplAction =
  | { type: "help" }
  | { type: "exit" }
  | { type: "restart" }
  | { type: "echo"; text: string }
  | { type: "unknown"; command: string };

export interface TuiOptions {
  config: AppConfig;
  username?: string;
  model?: string;
  sessionName?: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
