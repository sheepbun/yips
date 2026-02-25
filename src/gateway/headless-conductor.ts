import { runConductorTurn, type ConductorAssistantReply } from "#agent/conductor";
import { loadCodeContext, toCodeContextSystemMessage } from "#agent/context/code-context";
import { createSessionFileFromHistory, writeSessionFile } from "#agent/context/session-store";
import { executeSkillCall } from "#agent/skills/skills";
import { executeToolCall } from "#agent/tools/tool-executor";
import {
  assessCommandRisk,
  assessPathRisk,
  resolveToolPath,
  type ToolRisk
} from "#agent/tools/tool-safety";
import { ensureLlamaReady, formatLlamaStartupFailure } from "#llm/llama-server";
import { LlamaClient, type ChatResult } from "#llm/llama-client";
import { estimateConversationTokens } from "#llm/token-counter";
import type {
  AppConfig,
  ChatMessage,
  SkillCall,
  SkillResult,
  SubagentCall,
  SubagentResult,
  ToolCall,
  ToolResult
} from "#types/app-types";
import type { GatewayMessageContext, GatewayMessageResponse } from "#gateway/types";
import { VirtualTerminalSession } from "#ui/input/vt-session";

const UNSUPPORTED_BACKEND_RESPONSE =
  "Gateway headless mode currently supports backend 'llamacpp' only.";
const AUTO_DENY_OUTPUT = "Action denied by gateway safety policy.";

interface HeadlessSessionState {
  history: ChatMessage[];
  sessionFilePath: string | null;
}

function composeChatRequestMessages(
  history: readonly ChatMessage[],
  codeContextMessage: string | null
): readonly ChatMessage[] {
  if (!codeContextMessage) {
    return history;
  }
  return [{ role: "system", content: codeContextMessage }, ...history];
}

function buildSubagentScopeMessage(call: SubagentCall): string {
  const lines = [
    "Subagent scope:",
    `Task: ${call.task}`,
    call.context ? `Context: ${call.context}` : null,
    call.allowedTools
      ? `Allowed tools: ${call.allowedTools.length > 0 ? call.allowedTools.join(", ") : "(none)"}`
      : "Allowed tools: all available tools",
    "Stay focused on the delegated scope and return concise findings."
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

function assessToolCallRisk(call: ToolCall, workingZone: string): ToolRisk {
  if (call.name === "run_command") {
    const command = typeof call.arguments["command"] === "string" ? call.arguments["command"] : "";
    const cwdArg = typeof call.arguments["cwd"] === "string" ? call.arguments["cwd"] : ".";
    const resolvedCwd = resolveToolPath(cwdArg, workingZone);
    return assessCommandRisk(command, resolvedCwd, workingZone);
  }

  const pathArg = typeof call.arguments["path"] === "string" ? call.arguments["path"] : ".";
  return assessPathRisk(pathArg, workingZone);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface GatewayHeadlessConductorDeps {
  createLlamaClient: (config: AppConfig) => LlamaClient;
  ensureReady: typeof ensureLlamaReady;
  formatStartupFailure: typeof formatLlamaStartupFailure;
  runConductor: typeof runConductorTurn;
  executeTool: typeof executeToolCall;
  executeSkill: typeof executeSkillCall;
  createVtSession: () => VirtualTerminalSession;
  loadCodeContext: typeof loadCodeContext;
  toCodeContextSystemMessage: typeof toCodeContextSystemMessage;
  createSessionFile: typeof createSessionFileFromHistory;
  writeSessionFile: typeof writeSessionFile;
  estimateCompletionTokens: (text: string) => number;
  estimateHistoryTokens: (history: readonly ChatMessage[]) => number;
}

const DEFAULT_DEPS: GatewayHeadlessConductorDeps = {
  createLlamaClient: (config: AppConfig) =>
    new LlamaClient({
      baseUrl: config.llamaBaseUrl,
      model: config.model
    }),
  ensureReady: ensureLlamaReady,
  formatStartupFailure: formatLlamaStartupFailure,
  runConductor: runConductorTurn,
  executeTool: executeToolCall,
  executeSkill: executeSkillCall,
  createVtSession: () => new VirtualTerminalSession(),
  loadCodeContext,
  toCodeContextSystemMessage,
  createSessionFile: createSessionFileFromHistory,
  writeSessionFile,
  estimateCompletionTokens: (text: string): number => estimateConversationTokens([{ content: text }]),
  estimateHistoryTokens: (history: readonly ChatMessage[]): number => estimateConversationTokens(history)
};

export interface GatewayHeadlessConductorOptions {
  config: AppConfig;
  username?: string;
  workingDirectory?: string;
  maxRounds?: number;
  gatewayBackend?: AppConfig["backend"];
}

export class GatewayHeadlessConductor {
  private readonly config: AppConfig;
  private readonly gatewayBackend: AppConfig["backend"];
  private readonly username: string;
  private readonly workingDirectory: string;
  private readonly maxRounds: number | undefined;
  private readonly deps: GatewayHeadlessConductorDeps;
  private readonly sessionStates = new Map<string, HeadlessSessionState>();
  private readonly llamaClient: LlamaClient;
  private readonly vtSession: VirtualTerminalSession;
  private codeContextMessage: string | null = null;

  constructor(
    options: GatewayHeadlessConductorOptions,
    deps: Partial<GatewayHeadlessConductorDeps> = {}
  ) {
    this.config = options.config;
    this.gatewayBackend = options.gatewayBackend ?? this.config.backend;
    this.username = options.username ?? "Gateway User";
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.maxRounds = options.maxRounds;
    this.deps = { ...DEFAULT_DEPS, ...deps };
    this.llamaClient = this.deps.createLlamaClient(this.config);
    this.vtSession = this.deps.createVtSession();
  }

  async initialize(): Promise<void> {
    const loaded = await this.deps.loadCodeContext(this.workingDirectory);
    if (!loaded) {
      this.codeContextMessage = null;
      return;
    }
    this.codeContextMessage = this.deps.toCodeContextSystemMessage(loaded);
  }

  async handleMessage(context: GatewayMessageContext): Promise<GatewayMessageResponse> {
    if (this.gatewayBackend !== "llamacpp") {
      return {
        text: `${UNSUPPORTED_BACKEND_RESPONSE} Configured backend: '${this.gatewayBackend}'.`
      };
    }

    const state = this.getOrCreateSessionState(context);
    state.history.push({ role: "user", content: context.message.text });

    let latestAssistantText = "";

    try {
      await this.deps.runConductor({
        history: state.history,
        requestAssistant: async (): Promise<ConductorAssistantReply> => {
          const readiness = await this.deps.ensureReady(this.config);
          if (!readiness.ready) {
            throw new Error(
              readiness.failure
                ? this.deps.formatStartupFailure(readiness.failure, this.config)
                : "llama.cpp is unavailable."
            );
          }

          this.llamaClient.setModel(this.config.model);
          const requestMessages = composeChatRequestMessages(state.history, this.codeContextMessage);
          const result: ChatResult = await this.llamaClient.chat(requestMessages, this.config.model);
          return {
            text: result.text,
            rendered: false,
            totalTokens: result.usage?.totalTokens,
            completionTokens:
              result.usage?.completionTokens ?? this.deps.estimateCompletionTokens(result.text)
          };
        },
        executeToolCalls: async (toolCalls: readonly ToolCall[]): Promise<ToolResult[]> => {
          const results: ToolResult[] = [];

          for (const call of toolCalls) {
            const risk = assessToolCallRisk(call, this.workingDirectory);
            if (risk.requiresConfirmation) {
              results.push({
                callId: call.id,
                tool: call.name,
                status: "denied",
                output: AUTO_DENY_OUTPUT
              });
              continue;
            }

            const result = await this.deps.executeTool(call, {
              workingDirectory: this.workingDirectory,
              vtSession: this.vtSession
            });
            results.push(result);
          }

          return results;
        },
        executeSkillCalls: async (skillCalls: readonly SkillCall[]): Promise<SkillResult[]> => {
          const results: SkillResult[] = [];
          for (const call of skillCalls) {
            const result = await this.deps.executeSkill(call, {
              workingDirectory: this.workingDirectory,
              vtSession: this.vtSession
            });
            results.push(result);
          }
          return results;
        },
        executeSubagentCalls: async (
          subagentCalls: readonly SubagentCall[]
        ): Promise<SubagentResult[]> => {
          const results: SubagentResult[] = [];

          for (const subagentCall of subagentCalls) {
            const scopedHistory: ChatMessage[] = [
              { role: "system", content: buildSubagentScopeMessage(subagentCall) },
              { role: "user", content: subagentCall.task }
            ];
            const allowedTools =
              subagentCall.allowedTools !== undefined ? new Set(subagentCall.allowedTools) : null;

            try {
              const turn = await this.deps.runConductor({
                history: scopedHistory,
                requestAssistant: async (): Promise<ConductorAssistantReply> => {
                  const readiness = await this.deps.ensureReady(this.config);
                  if (!readiness.ready) {
                    throw new Error(
                      readiness.failure
                        ? this.deps.formatStartupFailure(readiness.failure, this.config)
                        : "llama.cpp is unavailable."
                    );
                  }

                  this.llamaClient.setModel(this.config.model);
                  const requestMessages = composeChatRequestMessages(scopedHistory, null);
                  const result: ChatResult = await this.llamaClient.chat(
                    requestMessages,
                    this.config.model
                  );
                  return {
                    text: result.text,
                    rendered: false,
                    totalTokens: result.usage?.totalTokens,
                    completionTokens:
                      result.usage?.completionTokens ??
                      this.deps.estimateCompletionTokens(result.text)
                  };
                },
                executeToolCalls: async (
                  toolCalls: readonly ToolCall[]
                ): Promise<ToolResult[]> => {
                  const denied: ToolResult[] = [];
                  const permitted: ToolCall[] = [];

                  for (const call of toolCalls) {
                    if (allowedTools && !allowedTools.has(call.name)) {
                      denied.push({
                        callId: call.id,
                        tool: call.name,
                        status: "denied",
                        output: `Tool '${call.name}' is not allowed for subagent ${subagentCall.id}.`
                      });
                      continue;
                    }

                    const risk = assessToolCallRisk(call, this.workingDirectory);
                    if (risk.requiresConfirmation) {
                      denied.push({
                        callId: call.id,
                        tool: call.name,
                        status: "denied",
                        output: AUTO_DENY_OUTPUT
                      });
                      continue;
                    }

                    permitted.push(call);
                  }

                  const executed: ToolResult[] = [];
                  for (const call of permitted) {
                    const result = await this.deps.executeTool(call, {
                      workingDirectory: this.workingDirectory,
                      vtSession: this.vtSession
                    });
                    executed.push(result);
                  }

                  return [...denied, ...executed];
                },
                executeSkillCalls: async (
                  skillCalls: readonly SkillCall[]
                ): Promise<SkillResult[]> => {
                  const skillResults: SkillResult[] = [];
                  for (const call of skillCalls) {
                    const result = await this.deps.executeSkill(call, {
                      workingDirectory: this.workingDirectory,
                      vtSession: this.vtSession
                    });
                    skillResults.push(result);
                  }
                  return skillResults;
                },
                onAssistantText: (): void => {
                  // Subagent responses are returned in metadata only.
                },
                onWarning: (): void => {
                  // Warnings are intentionally omitted from outbound gateway text.
                },
                estimateCompletionTokens: this.deps.estimateCompletionTokens,
                estimateHistoryTokens: this.deps.estimateHistoryTokens,
                computeTokensPerSecond: () => null,
                maxRounds: subagentCall.maxRounds ?? 4
              });

              const latest = [...scopedHistory]
                .reverse()
                .find((entry) => entry.role === "assistant")?.content;

              results.push({
                callId: subagentCall.id,
                status: turn.finished ? "ok" : "timeout",
                output: latest ?? "Subagent completed without assistant output.",
                metadata: {
                  rounds: turn.rounds
                }
              });
            } catch (error) {
              results.push({
                callId: subagentCall.id,
                status: "error",
                output: `Subagent failed: ${toErrorMessage(error)}`
              });
            }
          }

          return results;
        },
        onAssistantText: (assistantText: string): void => {
          latestAssistantText = assistantText;
        },
        onWarning: (): void => {
          // Warnings are intentionally omitted from outbound gateway text.
        },
        estimateCompletionTokens: this.deps.estimateCompletionTokens,
        estimateHistoryTokens: this.deps.estimateHistoryTokens,
        computeTokensPerSecond: () => null,
        maxRounds: this.maxRounds
      });
    } catch (error) {
      const message = `Request failed: ${toErrorMessage(error)}`;
      state.history.push({ role: "assistant", content: message });
      await this.persistSession(state);
      return { text: message };
    }

    const finalText = latestAssistantText.trim().length > 0 ? latestAssistantText : "(no response)";
    await this.persistSession(state);
    return { text: finalText };
  }

  dispose(): void {
    this.vtSession.dispose();
    this.sessionStates.clear();
  }

  private getOrCreateSessionState(context: GatewayMessageContext): HeadlessSessionState {
    const key = `${context.session.id}:${context.session.createdAt.toISOString()}`;
    const existing = this.sessionStates.get(key);
    if (existing) {
      return existing;
    }
    const created: HeadlessSessionState = {
      history: [],
      sessionFilePath: null
    };
    this.sessionStates.set(key, created);
    return created;
  }

  private async persistSession(state: HeadlessSessionState): Promise<void> {
    if (state.history.length === 0) {
      return;
    }

    if (!state.sessionFilePath) {
      const created = await this.deps.createSessionFile(state.history);
      state.sessionFilePath = created.path;
    }

    await this.deps.writeSessionFile({
      path: state.sessionFilePath,
      username: this.username,
      history: state.history
    });
  }
}

export interface GatewayHeadlessHandler {
  handleMessage: (context: GatewayMessageContext) => Promise<GatewayMessageResponse>;
  dispose: () => void;
}

export async function createGatewayHeadlessMessageHandler(
  options: GatewayHeadlessConductorOptions,
  deps: Partial<GatewayHeadlessConductorDeps> = {}
): Promise<GatewayHeadlessHandler> {
  const runtime = new GatewayHeadlessConductor(options, deps);
  await runtime.initialize();
  return {
    handleMessage: async (context: GatewayMessageContext): Promise<GatewayMessageResponse> =>
      await runtime.handleMessage(context),
    dispose: (): void => {
      runtime.dispose();
    }
  };
}
