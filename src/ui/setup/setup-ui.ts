import {
  colorText,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  horizontalGradientAtOffset,
  stripAnsi,
  WARNING_YELLOW
} from "#ui/colors";
import { SETUP_CHANNELS, type SetupState } from "#ui/setup/setup-state";
import type { GatewayChannel, GatewayChannelsConfig } from "#types/app-types";

interface SetupRenderOptions {
  width: number;
  state: SetupState;
  channels: GatewayChannelsConfig;
  draftToken: string;
}

function charLength(text: string): number {
  return Array.from(stripAnsi(text)).length;
}

function fitLeft(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) {
    return text;
  }
  if (width <= 3) {
    return chars.slice(0, width).join("");
  }
  return `${chars.slice(0, width - 3).join("")}...`;
}

function makeBorderTop(width: number): string {
  if (width <= 1) return "╭";

  const prefix = "╭─── ";
  const titleBrand = "Yips";
  const titleDetail = " Setup";
  const titleTail = " ";
  const prefixLen = charLength(prefix);
  const titleBrandLen = charLength(titleBrand);
  const titleDetailLen = charLength(titleDetail);
  const titleTailLen = charLength(titleTail);
  const plainTitleLen = prefixLen + titleBrandLen + titleDetailLen + titleTailLen;
  const fill = "─".repeat(Math.max(0, width - plainTitleLen - 1));
  const fillOffset = prefixLen + titleBrandLen + titleDetailLen + titleTailLen;
  const cornerOffset = width - 1;
  return `${horizontalGradientAtOffset(prefix, GRADIENT_PINK, GRADIENT_YELLOW, 0, width)}${horizontalGradient(titleBrand, GRADIENT_PINK, GRADIENT_YELLOW)}${colorText(titleDetail, GRADIENT_BLUE)}${horizontalGradientAtOffset(titleTail, GRADIENT_PINK, GRADIENT_YELLOW, prefixLen + titleBrandLen + titleDetailLen, width)}${horizontalGradientAtOffset(fill, GRADIENT_PINK, GRADIENT_YELLOW, fillOffset, width)}${horizontalGradientAtOffset("╮", GRADIENT_PINK, GRADIENT_YELLOW, cornerOffset, width)}`;
}

function makeBorderBottom(width: number): string {
  if (width <= 1) return "╰";
  const mid = "─".repeat(Math.max(0, width - 2));
  return `${colorText("╰", GRADIENT_PINK)}${horizontalGradient(mid, GRADIENT_PINK, GRADIENT_YELLOW)}${colorText("╯", GRADIENT_YELLOW)}`;
}

function lineWithBorders(inner: string, innerWidth: number): string {
  let fitted = inner;
  if (charLength(fitted) > innerWidth) {
    fitted = fitLeft(stripAnsi(inner), innerWidth);
  }
  const padding = " ".repeat(Math.max(0, innerWidth - charLength(fitted)));
  return `${colorText("│", GRADIENT_PINK)}${fitted}${padding}${colorText("│", GRADIENT_YELLOW)}`;
}

function formatChannelLabel(channel: GatewayChannel): string {
  if (channel === "whatsapp") {
    return "WhatsApp";
  }
  if (channel === "telegram") {
    return "Telegram";
  }
  return "Discord";
}

export function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return "<not set>";
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}${"*".repeat(trimmed.length - 6)}${trimmed.slice(trimmed.length - 3)}`;
}

export function renderSetupLines(options: SetupRenderOptions): string[] {
  const width = Math.max(20, options.width);
  const innerWidth = Math.max(1, width - 2);
  const lines: string[] = [];

  lines.push(makeBorderTop(width));
  lines.push(
    lineWithBorders(
      colorText("Configure channel bot tokens for gateway runtimes.", GRADIENT_BLUE),
      innerWidth
    )
  );
  lines.push(lineWithBorders("", innerWidth));

  for (const [index, channel] of SETUP_CHANNELS.entries()) {
    const selected = index === options.state.selectedChannelIndex;
    const editing = options.state.editingChannel === channel;
    const saved = options.channels[channel].botToken;
    const value = editing ? options.draftToken : saved;
    const marker = selected ? ">" : " ";
    const mode = editing ? colorText(" [editing]", WARNING_YELLOW) : "";
    const row = `${marker} ${formatChannelLabel(channel).padEnd(9, " ")} | ${maskToken(value)}${mode}`;
    lines.push(lineWithBorders(row, innerWidth));
  }

  lines.push(lineWithBorders("", innerWidth));
  lines.push(
    lineWithBorders(
      horizontalGradient(
        "[↑/↓] Select  [Enter] Edit/Save  [Esc] Cancel/Close",
        GRADIENT_PINK,
        GRADIENT_YELLOW
      ),
      innerWidth
    )
  );
  lines.push(makeBorderBottom(width));

  return lines;
}
