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

export type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "list_dir"
  | "grep"
  | "run_command";

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface SubagentCall {
  id: string;
  task: string;
  context?: string;
  allowedTools?: ToolName[];
  maxRounds?: number;
}

export type ToolExecutionStatus = "ok" | "error" | "denied" | "timeout";

export interface ToolResult {
  callId: string;
  tool: ToolName;
  status: ToolExecutionStatus;
  output: string;
  metadata?: Record<string, unknown>;
}

export type SubagentExecutionStatus = "ok" | "error" | "timeout";

export interface SubagentResult {
  callId: string;
  status: SubagentExecutionStatus;
  output: string;
  metadata?: Record<string, unknown>;
}
