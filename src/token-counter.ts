export interface AutoTokenMaxInput {
  ramGb: number;
  modelSizeBytes: number;
}

interface TokenizableMessage {
  content: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeAutoMaxTokens(input: AutoTokenMaxInput): number {
  const safeRamGb = Number.isFinite(input.ramGb) && input.ramGb > 0 ? input.ramGb : 0;
  const safeModelBytes =
    Number.isFinite(input.modelSizeBytes) && input.modelSizeBytes > 0 ? input.modelSizeBytes : 0;
  const modelSizeGb = safeModelBytes / 1024 ** 3;
  const availableGb = Math.max(0, safeRamGb - modelSizeGb - 2);
  const rawTokens = Math.floor(availableGb * 1500);
  return clamp(rawTokens, 4096, 128000);
}

export function resolveEffectiveMaxTokens(tokensMode: "auto" | "manual", manualMax: number, autoMax: number): number {
  if (tokensMode === "manual") {
    return Number.isFinite(manualMax) && manualMax > 0 ? Math.floor(manualMax) : autoMax;
  }
  return autoMax;
}

function formatTokenCount(value: number): string {
  if (value < 1000) {
    return String(Math.floor(value));
  }
  const rounded = Number((value / 1000).toFixed(1));
  const compact = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${compact}k`;
}

export function formatTitleTokenUsage(usedTokens: number, maxTokens: number): string {
  const safeUsed = Number.isFinite(usedTokens) && usedTokens > 0 ? usedTokens : 0;
  const safeMax = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  return `${formatTokenCount(safeUsed)}/${formatTokenCount(safeMax)} tks`;
}

export function estimateConversationTokens(messages: readonly TokenizableMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const chars = Array.from(message.content).length;
    if (chars === 0) {
      continue;
    }
    total += Math.max(1, Math.ceil(chars / 4));
  }
  return total;
}
