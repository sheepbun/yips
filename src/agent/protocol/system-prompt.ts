import type { ChatMessage } from "#types/app-types";

export const TOOL_PROTOCOL_SYSTEM_PROMPT = [
  "Tool protocol:",
  "When you need tools, skills, or subagents, emit exactly one fenced JSON block.",
  "Preferred format:",
  "```yips-agent",
  '{"assistant_text":"optional","actions":[{"type":"tool","id":"t1","name":"read_file","arguments":{"path":"README.md"}}]}',
  "```",
  "Rules:",
  "- Use exactly one block per assistant message.",
  "- Keep action ids unique within a message.",
  "- Allowed tools: read_file, write_file, edit_file, list_dir, grep, run_command.",
  "- Allowed skills: search, fetch, build, todos, virtual_terminal.",
  "- Subagent actions use type 'subagent' with fields: id, task, optional context, optional allowed_tools, optional max_rounds.",
  "- If no action is needed, answer normally without a tool block."
].join("\n");

export function composeChatRequestMessages(
  history: readonly ChatMessage[],
  codeContextMessage: string | null
): readonly ChatMessage[] {
  const systemMessages: ChatMessage[] = [{ role: "system", content: TOOL_PROTOCOL_SYSTEM_PROMPT }];
  if (codeContextMessage) {
    systemMessages.push({ role: "system", content: codeContextMessage });
  }
  return [...systemMessages, ...history];
}
