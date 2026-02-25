import type {
  ChatMessage,
  SkillCall,
  SkillExecutionStatus,
  SkillResult,
  SubagentCall,
  SubagentExecutionStatus,
  SubagentResult,
  ToolCall,
  ToolExecutionStatus,
  ToolResult
} from "#types/app-types";

export type AgentActionKind = "tool" | "skill" | "subagent";

export interface AgentToolActionCall {
  kind: "tool";
  call: ToolCall;
}

export interface AgentSkillActionCall {
  kind: "skill";
  call: SkillCall;
}

export interface AgentSubagentActionCall {
  kind: "subagent";
  call: SubagentCall;
}

export type AgentActionCall =
  | AgentToolActionCall
  | AgentSkillActionCall
  | AgentSubagentActionCall;

export type AgentActionStatus = ToolExecutionStatus | SkillExecutionStatus | SubagentExecutionStatus;

export interface AgentActionResult {
  kind: AgentActionKind;
  callId: string;
  status: AgentActionStatus;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface AgentWarning {
  code: string;
  message: string;
}

export interface AgentAssistantReply {
  text: string;
  rendered: boolean;
  totalTokens?: number;
  completionTokens?: number;
  generationDurationMs?: number;
}

export interface AgentTurnRequest {
  history: ChatMessage[];
  requestAssistant: () => Promise<AgentAssistantReply>;
  executeActions: (actions: readonly AgentActionCall[]) => Promise<AgentActionResult[]>;
  onAssistantText: (assistantText: string, rendered: boolean) => void;
  onWarning: (warning: AgentWarning) => void;
  onRoundComplete?: () => void;
  estimateCompletionTokens: (text: string) => number;
  estimateHistoryTokens: (history: readonly ChatMessage[]) => number;
  computeTokensPerSecond: (tokens: number, durationMs: number) => number | null;
  maxRounds?: number;
}

export interface AgentTurnResult {
  finished: boolean;
  rounds: number;
  latestOutputTokensPerSecond: number | null;
  usedTokensExact: number | null;
}

export function toLegacyToolResult(result: AgentActionResult): ToolResult {
  return {
    callId: result.callId,
    tool: "read_file",
    status: result.status as ToolExecutionStatus,
    output: result.output,
    metadata: result.metadata
  };
}

export function toAgentToolResult(result: ToolResult): AgentActionResult {
  return {
    kind: "tool",
    callId: result.callId,
    status: result.status,
    output: result.output,
    metadata: result.metadata
  };
}

export function toAgentSkillResult(result: SkillResult): AgentActionResult {
  return {
    kind: "skill",
    callId: result.callId,
    status: result.status,
    output: result.output,
    metadata: result.metadata
  };
}

export function toAgentSubagentResult(result: SubagentResult): AgentActionResult {
  return {
    kind: "subagent",
    callId: result.callId,
    status: result.status,
    output: result.output,
    metadata: result.metadata
  };
}
