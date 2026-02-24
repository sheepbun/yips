export type Backend = "llamacpp" | "claude";

export interface AppConfig {
  streaming: boolean;
  verbose: boolean;
  backend: Backend;
  llamaBaseUrl: string;
  model: string;
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
