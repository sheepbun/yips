import { formatAssistantMessage, formatDimMessage, formatUserMessage } from "#ui/messages";
import { composeChatRequestMessages as composeChatMessagesWithProtocol } from "#agent/protocol/system-prompt";
import type { ChatMessage } from "#types/app-types";

export function renderHistoryLines(history: readonly ChatMessage[]): {
  lines: string[];
  userCount: number;
} {
  const lines: string[] = [];
  let userCount = 0;

  for (const entry of history) {
    if (entry.role === "user") {
      userCount += 1;
      lines.push(...formatUserMessage(entry.content).split("\n"));
      continue;
    }

    if (entry.role === "assistant") {
      lines.push(...formatAssistantMessage(entry.content).split("\n"));
      lines.push("");
      continue;
    }

    lines.push(...formatDimMessage(`[system] ${entry.content}`).split("\n"));
  }

  return { lines, userCount };
}

export function composeChatRequestMessages(
  history: readonly ChatMessage[],
  codeContextMessage: string | null
): readonly ChatMessage[] {
  return composeChatMessagesWithProtocol(history, codeContextMessage);
}
