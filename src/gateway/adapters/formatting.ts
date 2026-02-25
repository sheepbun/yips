const MENTION_GUARD = "\u200B";

function splitByLimit(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) {
    return [value];
  }

  const chunks: string[] = [];
  let current = value;
  while (current.length > maxLength) {
    chunks.push(current.slice(0, maxLength));
    current = current.slice(maxLength);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function stripCommonMarkdown(input: string): string {
  let output = input;

  output = output.replace(/```[^\n]*\n?/gu, "");
  output = output.replace(/```/gu, "");
  output = output.replace(/`([^`]+)`/gu, "$1");
  output = output.replace(/`/gu, "");

  const pairedPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\*\*([^*\n][^*]*?)\*\*/gu, "$1"],
    [/__([^_\n][^_]*?)__/gu, "$1"],
    [/~~([^~\n][^~]*?)~~/gu, "$1"],
    [/\*([^*\n]+)\*/gu, "$1"],
    [/_([^_\n]+)_/gu, "$1"]
  ];

  for (const [pattern, replacement] of pairedPatterns) {
    let previous = "";
    while (previous !== output) {
      previous = output;
      output = output.replace(pattern, replacement);
    }
  }

  return output;
}

export function sanitizeMentions(input: string): string {
  let output = input;

  output = output.replace(/@(everyone|here)\b/giu, (_match, group: string) => `@${MENTION_GUARD}${group}`);
  output = output.replace(/<@([!&]?\d+)>/gu, `<@${MENTION_GUARD}$1>`);
  output = output.replace(
    /(^|[\s([{'"`])@([A-Za-z0-9_.-]{1,64})/gu,
    (_match, prefix: string, mention: string) => `${prefix}@${MENTION_GUARD}${mention}`
  );

  return output;
}

export function normalizeOutboundText(input: string): string {
  let output = input.replace(/\r\n?/gu, "\n");
  output = output.trim();
  output = output.replace(/\n{3,}/gu, "\n\n");
  output = stripCommonMarkdown(output);
  output = sanitizeMentions(output);
  output = output.replace(/\n{3,}/gu, "\n\n");
  return output.trim();
}

export function chunkOutboundText(input: string, maxLength: number): string[] {
  const normalizedMaxLength = Math.max(1, Math.trunc(maxLength));
  const text = input.trim();
  if (text.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= normalizedMaxLength) {
      const lastChunk = text.slice(start).trim();
      if (lastChunk.length > 0) {
        chunks.push(lastChunk);
      }
      break;
    }

    const window = text.slice(start, start + normalizedMaxLength + 1);
    const breakOnNewline = window.lastIndexOf("\n");
    const breakOnSpace = window.lastIndexOf(" ");
    const breakOffset = Math.max(breakOnNewline, breakOnSpace);
    let end = breakOffset > 0 ? start + breakOffset : start + normalizedMaxLength;

    let chunk = text.slice(start, end).trim();
    if (chunk.length === 0) {
      end = start + normalizedMaxLength;
      chunk = text.slice(start, end).trim();
    }

    if (chunk.length > 0) {
      chunks.push(...splitByLimit(chunk, normalizedMaxLength));
    }

    start = end;
    while (start < text.length && /\s/u.test(text[start] ?? "")) {
      start += 1;
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}
