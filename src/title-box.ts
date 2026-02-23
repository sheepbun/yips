/** Responsive title box with ASCII logo and gradient borders. */

import {
  colorText,
  diagonalGradient,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient
} from "./colors";

export interface TitleBoxOptions {
  width: number;
  version: string;
  username: string;
  backend: string;
  model: string;
  tokenUsage: string;
  cwd: string;
  sessionName: string;
}

type LayoutMode = "full" | "single" | "compact" | "minimal";

const YIPS_LOGO = [
  "██╗   ██╗██╗██████╗ ███████╗",
  "╚██╗ ██╔╝██║██╔══██╗██╔════╝",
  " ╚████╔╝ ██║██████╔╝███████╗",
  "  ╚██╔╝  ██║██╔═══╝ ╚════██║",
  "   ██║   ██║██║     ███████║",
  "   ╚═╝   ╚═╝╚═╝     ╚══════╝"
];

const LOGO_WIDTH = 28;

function getLayoutMode(width: number): LayoutMode {
  if (width >= 80) return "full";
  if (width >= 60) return "single";
  if (width >= 45) return "compact";
  return "minimal";
}

function makeTopBorder(label: string, width: number): string {
  const innerWidth = width - 2;
  const labelSection = `─── ${label} `;
  const remaining = innerWidth - labelSection.length;
  const fill = "─".repeat(Math.max(0, remaining));
  const content = labelSection + fill;
  return horizontalGradient(`╭${content}╮`, GRADIENT_PINK, GRADIENT_YELLOW);
}

function makeBottomBorder(label: string, width: number): string {
  const innerWidth = width - 2;
  const labelSection = `─── ${label} `;
  const remaining = innerWidth - labelSection.length;
  const fill = "─".repeat(Math.max(0, remaining));
  const content = labelSection + fill;
  return horizontalGradient(`╰${content}╯`, GRADIENT_PINK, GRADIENT_YELLOW);
}

function makeSideBorders(content: string, width: number): string {
  const leftBorder = horizontalGradient("│", GRADIENT_PINK, GRADIENT_PINK);
  const rightBorder = horizontalGradient("│", GRADIENT_YELLOW, GRADIENT_YELLOW);
  const innerWidth = width - 4;
  const visibleLen = stripMarkup(content).length;
  const padding = Math.max(0, innerWidth - visibleLen);
  return `${leftBorder} ${content}${" ".repeat(padding)} ${rightBorder}`;
}

/** Strip terminal-kit markup sequences for length calculation. */
export function stripMarkup(text: string): string {
  return text.replace(/\^#[0-9a-fA-F]{6}|\^:/g, "");
}

function renderFull(options: TitleBoxOptions): string[] {
  const { width, version, username, backend, model, tokenUsage, cwd, sessionName } = options;
  const lines: string[] = [];

  lines.push(makeTopBorder(`Yips CLI v${version}`, width));

  const gradientLogo = diagonalGradient(YIPS_LOGO, GRADIENT_PINK, GRADIENT_YELLOW);

  const infoLines = [
    "",
    `Welcome, ${username}!`,
    "",
    `${backend} · ${model} · ${tokenUsage}`,
    cwd,
    ""
  ];

  const infoWidth = width - LOGO_WIDTH - 8;

  for (let i = 0; i < YIPS_LOGO.length; i++) {
    const logo = gradientLogo[i] ?? "";
    const info = infoLines[i] ?? "";
    const infoPadded = info.length > infoWidth ? info.slice(0, infoWidth) : info;
    const logoPlain = YIPS_LOGO[i] ?? "";
    const gap = " ".repeat(Math.max(1, 4));
    const combined = `${logo}${gap}${infoPadded}`;
    const combinedPlain = `${logoPlain}${gap}${infoPadded}`;
    const innerWidth = width - 4;
    const padding = Math.max(0, innerWidth - combinedPlain.length);
    const leftBorder = horizontalGradient("│", GRADIENT_PINK, GRADIENT_PINK);
    const rightBorder = horizontalGradient("│", GRADIENT_YELLOW, GRADIENT_YELLOW);
    lines.push(`${leftBorder} ${combined}${" ".repeat(padding)} ${rightBorder}`);
  }

  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

function renderSingle(options: TitleBoxOptions): string[] {
  const { width, version, backend, model, tokenUsage, sessionName } = options;
  const lines: string[] = [];

  lines.push(makeTopBorder(`Yips CLI v${version}`, width));

  const gradientLogo = diagonalGradient(YIPS_LOGO, GRADIENT_PINK, GRADIENT_YELLOW);
  for (const logoLine of gradientLogo) {
    lines.push(makeSideBorders(logoLine, width));
  }

  const statusLine = `${backend} · ${model} · ${tokenUsage}`;
  lines.push(makeSideBorders(colorText(statusLine, GRADIENT_YELLOW), width));

  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

function renderCompact(options: TitleBoxOptions): string[] {
  const { width, version, backend, model, sessionName } = options;
  const lines: string[] = [];

  lines.push(makeTopBorder(`Yips v${version}`, width));

  const titleGradient = horizontalGradient("YIPS", GRADIENT_PINK, GRADIENT_YELLOW);
  lines.push(makeSideBorders(titleGradient, width));

  const statusLine = `${backend} · ${model}`;
  lines.push(makeSideBorders(colorText(statusLine, GRADIENT_YELLOW), width));

  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

function renderMinimal(options: TitleBoxOptions): string[] {
  const { width, version, sessionName } = options;
  const lines: string[] = [];

  lines.push(makeTopBorder(`Yips v${version}`, width));
  const titleGradient = horizontalGradient("YIPS", GRADIENT_PINK, GRADIENT_YELLOW);
  lines.push(makeSideBorders(titleGradient, width));
  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

export function renderTitleBox(options: TitleBoxOptions): string[] {
  const mode = getLayoutMode(options.width);

  switch (mode) {
    case "full":
      return renderFull(options);
    case "single":
      return renderSingle(options);
    case "compact":
      return renderCompact(options);
    case "minimal":
      return renderMinimal(options);
  }
}

export { getLayoutMode };
