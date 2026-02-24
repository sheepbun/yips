/** Responsive title box using the yips-cli visual contract. */

import {
  colorChar,
  colorText,
  DIM_GRAY,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  INPUT_PINK,
  interpolateColor,
  rowMajorGradient,
  stripAnsi
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
  recentActivity?: string[];
  sessionSelection?: {
    active: boolean;
    selectedIndex: number;
  };
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
const TOP_TITLE = "Yips";
const TOP_TITLE_FALLBACK = "Yips";
const TOP_BORDER_MIN_WIDTH = 25;

function getLayoutMode(width: number): LayoutMode {
  if (width >= 80) return "full";
  if (width >= 60) return "single";
  if (width >= 45) return "compact";
  return "minimal";
}

function centerText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length >= width) return text.slice(0, width);

  const leftPadding = Math.floor((width - text.length) / 2);
  const rightPadding = width - text.length - leftPadding;
  return `${" ".repeat(leftPadding)}${text}${" ".repeat(rightPadding)}`;
}

function fitText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length >= width) return text.slice(0, width);
  return text.padEnd(width, " ");
}

function toSingleColor(char: string, progress: number): string {
  return colorChar(char, interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, progress));
}

function makeTopBorder(version: string, width: number): string {
  if (width <= 0) return "";

  const fallback = `╭${"─".repeat(Math.max(0, width - 2))}╮`;
  if (width < TOP_BORDER_MIN_WIDTH) {
    return horizontalGradient(fallback, GRADIENT_PINK, GRADIENT_YELLOW);
  }

  let title = TOP_TITLE;
  let titleLength = title.length + 1 + version.length;
  let borderAvailable = width - titleLength - 7;

  if (borderAvailable < 0) {
    title = TOP_TITLE_FALLBACK;
    titleLength = title.length + 1 + version.length;
    borderAvailable = width - titleLength - 7;
    if (borderAvailable < 0) {
      return horizontalGradient(fallback, GRADIENT_PINK, GRADIENT_YELLOW);
    }
  }

  const pieces: string[] = [];
  let position = 0;

  const appendBorder = (segment: string): void => {
    for (const char of segment) {
      const progress = position / Math.max(width - 1, 1);
      pieces.push(toSingleColor(char, progress));
      position += 1;
    }
  };

  appendBorder("╭─── ");

  for (let i = 0; i < title.length; i++) {
    const progress = i / Math.max(title.length - 1, 1);
    pieces.push(toSingleColor(title[i]!, progress));
    position += 1;
  }

  pieces.push(" ");
  position += 1;
  pieces.push(colorText(version, GRADIENT_BLUE));
  position += version.length;

  const closing = ` ${"─".repeat(Math.max(0, borderAvailable))}╮`;
  appendBorder(closing);

  return pieces.join("");
}

/** Strip ANSI and legacy terminal-kit markup sequences for test/plain rendering. */
export function stripMarkup(text: string): string {
  return stripAnsi(text).replace(
    /\^\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]|\^#[0-9a-fA-F]{6}|\^:/g,
    ""
  );
}

function makeBottomBorder(sessionName: string, width: number): string {
  if (width <= 0) return "";

  const borderChars = Array.from({ length: Math.max(0, width - 2) }, () => "─");
  const trimmedSessionName = sessionName.trim();
  if (trimmedSessionName.length === 0) {
    return horizontalGradient(`╰${borderChars.join("")}╯`, GRADIENT_PINK, GRADIENT_YELLOW);
  }

  const displayName = ` ${trimmedSessionName.replace(/_/g, " ")} `;

  if (displayName.length <= borderChars.length) {
    const start = Math.floor((borderChars.length - displayName.length) / 2);
    for (let i = 0; i < displayName.length; i++) {
      borderChars[start + i] = displayName[i]!;
    }
  }

  return horizontalGradient(`╰${borderChars.join("")}╯`, GRADIENT_PINK, GRADIENT_YELLOW);
}

function buildModelInfo(backend: string, model: string, tokenUsage: string): string {
  const trimmedModel = model.trim();
  if (trimmedModel.length === 0) {
    return backend;
  }

  const parts = [backend, trimmedModel];
  const usage = tokenUsage.trim();
  if (usage.length > 0) {
    parts.push(usage);
  }
  return parts.join(" · ");
}

function padLine(markup: string, plain: string, width: number): string {
  const clippedPlain = fitText(plain, width);
  if (plain.length > width) {
    return clippedPlain;
  }
  const padding = " ".repeat(Math.max(0, width - plain.length));
  return `${markup}${padding}`;
}

function makeSingleRow(contentMarkup: string, contentPlain: string, width: number): string {
  const innerWidth = Math.max(0, width - 2);
  const leftBorder = horizontalGradient("│", GRADIENT_PINK, GRADIENT_PINK);
  const rightBorder = horizontalGradient("│", GRADIENT_YELLOW, GRADIENT_YELLOW);
  return `${leftBorder}${padLine(contentMarkup, contentPlain, innerWidth)}${rightBorder}`;
}

function styleCenteredText(
  text: string,
  width: number,
  style: "plain" | "gradient" | "blue" | "pink" | "dim"
): { markup: string; plain: string } {
  const centered = centerText(text, width);

  switch (style) {
    case "gradient":
      return {
        markup: horizontalGradient(centered, GRADIENT_PINK, GRADIENT_YELLOW),
        plain: centered
      };
    case "blue":
      return { markup: colorText(centered, GRADIENT_BLUE), plain: centered };
    case "pink":
      return { markup: colorText(centered, INPUT_PINK), plain: centered };
    case "dim":
      return { markup: colorText(centered, DIM_GRAY), plain: centered };
    case "plain":
      return { markup: centered, plain: centered };
  }
}

function styleCenteredTextWithGradientSpan(text: string, width: number): { markup: string; plain: string } {
  if (width <= 0) return { markup: "", plain: "" };

  const clipped = text.slice(0, width);
  if (clipped.length >= width) {
    return {
      markup: horizontalGradient(clipped, GRADIENT_PINK, GRADIENT_YELLOW),
      plain: clipped
    };
  }

  const leftPadding = Math.floor((width - clipped.length) / 2);
  const rightPadding = width - clipped.length - leftPadding;
  return {
    markup: `${" ".repeat(leftPadding)}${horizontalGradient(clipped, GRADIENT_PINK, GRADIENT_YELLOW)}${" ".repeat(rightPadding)}`,
    plain: `${" ".repeat(leftPadding)}${clipped}${" ".repeat(rightPadding)}`
  };
}

function withBold(row: { markup: string; plain: string }): { markup: string; plain: string } {
  if (row.markup.length === 0) return row;
  return { markup: `\u001b[1m${row.markup}\u001b[22m`, plain: row.plain };
}

function styleLeftText(
  text: string,
  width: number,
  style: "plain" | "gradient" | "blue" | "white" | "dim"
): { markup: string; plain: string } {
  const clipped = text.slice(0, Math.max(0, width));
  const padded = fitText(clipped, width);

  switch (style) {
    case "gradient":
      if (clipped.length === 0) return { markup: padded, plain: padded };
      return {
        markup: `${horizontalGradient(clipped, GRADIENT_PINK, GRADIENT_YELLOW)}${" ".repeat(
          Math.max(0, width - clipped.length)
        )}`,
        plain: padded
      };
    case "blue":
      if (clipped.length === 0) return { markup: padded, plain: padded };
      return {
        markup: `${colorText(clipped, GRADIENT_BLUE)}${" ".repeat(Math.max(0, width - clipped.length))}`,
        plain: padded
      };
    case "white":
      if (clipped.length === 0) return { markup: padded, plain: padded };
      return {
        markup: `${colorText(clipped, { r: 255, g: 255, b: 255 })}${" ".repeat(
          Math.max(0, width - clipped.length)
        )}`,
        plain: padded
      };
    case "dim":
      if (clipped.length === 0) return { markup: padded, plain: padded };
      return {
        markup: `${colorText(clipped, DIM_GRAY)}${" ".repeat(Math.max(0, width - clipped.length))}`,
        plain: padded
      };
    case "plain":
      return { markup: padded, plain: padded };
  }
}

function styleHighlightedText(text: string, width: number): { markup: string; plain: string } {
  const clipped = text.slice(0, Math.max(0, width));
  const padded = fitText(clipped, width);
  if (clipped.length === 0) return { markup: padded, plain: padded };
  return {
    markup: `\u001b[1m${colorText(clipped, INPUT_PINK)}\u001b[22m${" ".repeat(
      Math.max(0, width - clipped.length)
    )}`,
    plain: padded
  };
}

function styleLeftTextGlobalGradient(
  text: string,
  width: number,
  totalWidth: number,
  startColumn: number
): { markup: string; plain: string } {
  const clipped = text.slice(0, Math.max(0, width));
  const padded = fitText(clipped, width);
  if (clipped.length === 0) return { markup: padded, plain: padded };

  const maxColumn = Math.max(totalWidth - 1, 1);
  const startColor = interpolateColor(
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    Math.max(0, Math.min(1, startColumn / maxColumn))
  );
  const endColumn = startColumn + Math.max(clipped.length - 1, 0);
  const endColor = interpolateColor(
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    Math.max(0, Math.min(1, endColumn / maxColumn))
  );

  return {
    markup: `${horizontalGradient(clipped, startColor, endColor)}${" ".repeat(
      Math.max(0, width - clipped.length)
    )}`,
    plain: padded
  };
}

function centerLogoLine(
  logoMarkup: string,
  logoPlain: string,
  width: number
): { markup: string; plain: string } {
  const paddingLeft = Math.max(0, Math.floor((width - logoPlain.length) / 2));
  const paddingRight = Math.max(0, width - logoPlain.length - paddingLeft);
  return {
    markup: `${" ".repeat(paddingLeft)}${logoMarkup}${" ".repeat(paddingRight)}`,
    plain: `${" ".repeat(paddingLeft)}${logoPlain}${" ".repeat(paddingRight)}`
  };
}

function renderSingleColumn(
  options: TitleBoxOptions,
  mode: "single" | "compact" | "minimal"
): string[] {
  const { width, version, username, backend, model, tokenUsage, cwd, sessionName } = options;
  const innerWidth = Math.max(0, width - 2);
  const lines: string[] = [];
  const modelInfo = buildModelInfo(backend, model, tokenUsage);
  const gradientLogo = rowMajorGradient(YIPS_LOGO, GRADIENT_PINK, GRADIENT_YELLOW);
  const showLogo = innerWidth >= LOGO_WIDTH;

  lines.push(makeTopBorder(version, width));

  if (mode === "minimal") {
    const minimalRows: Array<{ markup: string; plain: string }> = [];
    minimalRows.push(styleCenteredText("", innerWidth, "plain"));

    if (showLogo) {
      for (let i = 0; i < YIPS_LOGO.length; i++) {
        minimalRows.push(centerLogoLine(gradientLogo[i] ?? "", YIPS_LOGO[i] ?? "", innerWidth));
      }
    } else {
      minimalRows.push(styleCenteredText("YIPS", innerWidth, "gradient"));
    }

    minimalRows.push(styleCenteredText(modelInfo, innerWidth, "blue"));
    minimalRows.push(styleCenteredText("", innerWidth, "plain"));

    for (const row of minimalRows) {
      lines.push(makeSingleRow(row.markup, row.plain, width));
    }

    lines.push(makeBottomBorder(sessionName, width));
    return lines;
  }

  const rows: Array<{ markup: string; plain: string }> = [];
  rows.push(styleCenteredText("", innerWidth, "plain"));
  rows.push(
    mode === "single"
      ? withBold(styleCenteredTextWithGradientSpan(`Welcome back ${username}!`, innerWidth))
      : styleCenteredTextWithGradientSpan(`Hi ${username}!`, innerWidth)
  );
  rows.push(styleCenteredText("", innerWidth, "plain"));

  if (showLogo) {
    for (let i = 0; i < YIPS_LOGO.length; i++) {
      rows.push(centerLogoLine(gradientLogo[i] ?? "", YIPS_LOGO[i] ?? "", innerWidth));
    }
  } else {
    rows.push(styleCenteredText("YIPS", innerWidth, "gradient"));
  }

  rows.push(styleCenteredText(modelInfo, innerWidth, "blue"));

  if (mode === "single") {
    rows.push(styleCenteredTextWithGradientSpan(cwd, innerWidth));
  }

  rows.push(styleCenteredText("", innerWidth, "plain"));

  for (const row of rows) {
    lines.push(makeSingleRow(row.markup, row.plain, width));
  }

  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

function renderFull(options: TitleBoxOptions): string[] {
  const {
    width,
    version,
    username,
    backend,
    model,
    tokenUsage,
    cwd,
    sessionName,
    recentActivity = [],
    sessionSelection
  } = options;
  const lines: string[] = [];
  const modelInfo = buildModelInfo(backend, model, tokenUsage);

  const availableWidth = Math.max(0, width - 3);
  const leftWidth = Math.max(Math.floor(availableWidth * 0.45), 30);
  const rightWidth = Math.max(0, availableWidth - leftWidth);
  const middleProgress = (leftWidth + 1) / Math.max(width - 1, 1);
  const middleBorderColor = interpolateColor(GRADIENT_PINK, GRADIENT_YELLOW, middleProgress);
  const leftBorder = horizontalGradient("│", GRADIENT_PINK, GRADIENT_PINK);
  const middleBorder = colorText("│", middleBorderColor);
  const rightBorder = horizontalGradient("│", GRADIENT_YELLOW, GRADIENT_YELLOW);
  const gradientLogo = rowMajorGradient(YIPS_LOGO, GRADIENT_PINK, GRADIENT_YELLOW);
  const rightStartColumn = leftWidth + 2;

  const leftRows: Array<{ markup: string; plain: string }> = [
    styleCenteredText("", leftWidth, "plain"),
    withBold(styleCenteredTextWithGradientSpan(`Welcome back ${username}!`, leftWidth)),
    styleCenteredText("", leftWidth, "plain")
  ];
  for (let i = 0; i < YIPS_LOGO.length; i++) {
    leftRows.push(centerLogoLine(gradientLogo[i] ?? "", YIPS_LOGO[i] ?? "", leftWidth));
  }
  leftRows.push(styleCenteredText(modelInfo, leftWidth, "blue"));
  leftRows.push(styleCenteredTextWithGradientSpan(cwd, leftWidth));
  leftRows.push(styleCenteredText("", leftWidth, "plain"));

  const rightRows: Array<{ markup: string; plain: string }> = [
    withBold(styleLeftTextGlobalGradient("Tips for getting started:", rightWidth, width, rightStartColumn)),
    styleLeftTextGlobalGradient(
      "- Ask questions, edit files, or run commands.",
      rightWidth,
      width,
      rightStartColumn
    ),
    styleLeftTextGlobalGradient(
      "- Be specific for the best results.",
      rightWidth,
      width,
      rightStartColumn
    ),
    styleLeftTextGlobalGradient(
      "- /help for more information.",
      rightWidth,
      width,
      rightStartColumn
    ),
    styleLeftText("", rightWidth, "plain"),
    styleLeftTextGlobalGradient(
      "─".repeat(Math.max(0, rightWidth)),
      rightWidth,
      width,
      rightStartColumn
    ),
    styleLeftText("Recent activity", rightWidth, "white")
  ];

  const activityItems = recentActivity.length > 0 ? recentActivity : ["No recent activity yet."];
  if (sessionSelection?.active) {
    const maxSlots = 5;
    const safeSelected = Math.max(0, Math.min(sessionSelection.selectedIndex, activityItems.length - 1));
    const start = Math.max(
      0,
      Math.min(safeSelected - Math.floor(maxSlots / 2), Math.max(0, activityItems.length - maxSlots))
    );
    const visible = activityItems.slice(start, start + maxSlots);

    for (let i = 0; i < visible.length; i++) {
      const actualIndex = start + i;
      const item = visible[i] ?? "";
      if (actualIndex === safeSelected) {
        rightRows.push(styleHighlightedText(`> ${item}`, rightWidth));
      } else {
        rightRows.push(styleLeftText(`  ${item}`, rightWidth, "dim"));
      }
    }
  } else {
    for (const item of activityItems.slice(0, 5)) {
      rightRows.push(styleLeftText(item, rightWidth, "dim"));
    }
  }

  while (rightRows.length < leftRows.length) {
    rightRows.push(styleLeftText("", rightWidth, "plain"));
  }

  lines.push(makeTopBorder(version, width));

  const maxRows = Math.max(leftRows.length, rightRows.length);
  for (let row = 0; row < maxRows; row++) {
    const left = leftRows[row] ?? styleLeftText("", leftWidth, "plain");
    const right = rightRows[row] ?? styleLeftText("", rightWidth, "plain");

    lines.push(
      `${leftBorder}${padLine(left.markup, left.plain, leftWidth)}${middleBorder}${padLine(right.markup, right.plain, rightWidth)}${rightBorder}`
    );
  }

  lines.push(makeBottomBorder(sessionName, width));
  return lines;
}

function renderCompact(options: TitleBoxOptions): string[] {
  return renderSingleColumn(options, "compact");
}

function renderMinimal(options: TitleBoxOptions): string[] {
  return renderSingleColumn(options, "minimal");
}

function renderSingle(options: TitleBoxOptions): string[] {
  return renderSingleColumn(options, "single");
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
