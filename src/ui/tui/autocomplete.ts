import { basename } from "node:path";

import { colorText, GRADIENT_BLUE, GRADIENT_PINK, GRADIENT_YELLOW, horizontalGradient, INPUT_PINK } from "#ui/colors";
import type { ModelAutocompleteCandidate, PromptComposer } from "#ui/prompt/prompt-composer";
import type { CommandRegistry } from "#agent/commands/commands";

import { ANSI_RESET_ALL, ANSI_REVERSE_ON, MAX_AUTOCOMPLETE_PREVIEW, PROMPT_PREFIX } from "#ui/tui/constants";

function charLength(text: string): number {
  return Array.from(text).length;
}

function withReverseHighlight(text: string): string {
  return `${ANSI_REVERSE_ON}${text}${ANSI_RESET_ALL}`;
}

export function buildModelAutocompleteCandidates(
  modelIds: readonly string[]
): ModelAutocompleteCandidate[] {
  const candidates: ModelAutocompleteCandidate[] = [];
  const seenValues = new Set<string>();

  for (const rawModelId of modelIds) {
    const value = rawModelId.trim();
    if (value.length === 0 || seenValues.has(value)) {
      continue;
    }
    seenValues.add(value);

    const aliases: string[] = [];
    const parentPath = value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
    if (parentPath.length > 0) {
      aliases.push(parentPath);
    }

    const segments = value.split("/").filter((segment) => segment.length > 0);
    if (segments.length >= 2) {
      aliases.push(`${segments[0]}/${segments[1]}`);
    }

    const filename = basename(value);
    if (filename.length > 0) {
      aliases.push(filename);
      if (filename.toLowerCase().endsWith(".gguf")) {
        aliases.push(filename.slice(0, -5));
      }
    }

    const dedupedAliases = [
      ...new Set(aliases.filter((alias) => alias.length > 0 && alias !== value))
    ];
    candidates.push({
      value,
      aliases: dedupedAliases
    });
  }

  return candidates;
}

export function shouldConsumeSubmitForAutocomplete(
  menu: {
    token: string;
    options: string[];
    selectedIndex: number;
  } | null
): boolean {
  if (!menu) {
    return false;
  }
  const selected = menu.options[menu.selectedIndex];
  if (!selected) {
    return false;
  }
  return selected !== menu.token;
}

export function buildAutocompleteOverlayLines(
  composer: PromptComposer,
  registry: CommandRegistry
): string[] {
  const menu = composer.getAutocompleteMenuState();
  if (!menu) {
    return [];
  }

  const descriptorBySlashName = new Map(
    registry.listCommands().map((descriptor) => [`/${descriptor.name}`, descriptor])
  );

  const lines: string[] = [];

  const windowSize = Math.min(MAX_AUTOCOMPLETE_PREVIEW, menu.options.length);
  const startIndex = Math.max(
    0,
    Math.min(menu.selectedIndex - Math.floor(windowSize / 2), menu.options.length - windowSize)
  );
  const visibleOptions = menu.options.slice(startIndex, startIndex + windowSize);
  const commandColumnWidth = Math.max(10, ...visibleOptions.map((option) => charLength(option)));
  const leftPadding = " ".repeat(1 + charLength(PROMPT_PREFIX));

  for (let rowIndex = 0; rowIndex < visibleOptions.length; rowIndex++) {
    const option = visibleOptions[rowIndex] ?? "";
    const descriptor = descriptorBySlashName.get(option);
    const description =
      descriptor?.description ?? (option.startsWith("/") ? "Command" : "Local model");
    const commandColor = descriptor?.kind === "skill" ? INPUT_PINK : GRADIENT_BLUE;
    const selected = startIndex + rowIndex === menu.selectedIndex;
    const paddedCommand = option.padEnd(commandColumnWidth, " ");
    const styledCommand = colorText(paddedCommand, commandColor);
    const styledDescription = horizontalGradient(description, GRADIENT_PINK, GRADIENT_YELLOW);
    const rowText = `${leftPadding}${styledCommand}   ${styledDescription}`;
    lines.push(selected ? withReverseHighlight(rowText) : rowText);
  }

  return lines;
}
