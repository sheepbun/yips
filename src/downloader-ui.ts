import {
  bgColorText,
  colorText,
  ERROR_RED,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  horizontalGradientBackground,
  stripAnsi,
  SUCCESS_GREEN,
  WARNING_YELLOW,
  type Rgb
} from "./colors";
import type { DownloaderState, DownloaderTab } from "./downloader-state";
const TAB_INACTIVE: Rgb = { r: 0x88, g: 0x88, b: 0x88 };
const BLACK: Rgb = { r: 0x00, g: 0x00, b: 0x00 };
const FOCUS_ACCENT_BG: Rgb = { r: 0xff, g: 0xcc, b: 0xff };
const DOWNLOADER_MODEL_BODY_ROWS = 10;
const DOWNLOADER_FILE_BODY_ROWS = 10;

interface DownloaderRenderOptions {
  width: number;
  state: DownloaderState;
}

function charLength(text: string): number {
  return Array.from(stripAnsi(text)).length;
}

function fitRight(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) {
    return text;
  }
  return chars.slice(chars.length - width).join("");
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

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) {
    return "?";
  }
  const gib = bytes / (1024 * 1024 * 1024);
  return `${gib.toFixed(1)}G`;
}

function tabText(tab: DownloaderTab, activeTab: DownloaderTab): string {
  const label = ` ${tab} `;
  if (tab === activeTab) {
    return horizontalGradientBackground(label, GRADIENT_PINK, GRADIENT_YELLOW, BLACK);
  }
  return colorText(label, TAB_INACTIVE);
}

function makeBorderTop(width: number): string {
  if (width <= 1) return "╭";

  const title = "╭─── Yips Model Downloader ";
  const plainTitleLen = charLength(title);
  const fill = "─".repeat(Math.max(0, width - plainTitleLen - 1));
  return `${horizontalGradient(title, GRADIENT_PINK, GRADIENT_YELLOW)}${horizontalGradient(fill, GRADIENT_PINK, GRADIENT_YELLOW)}${colorText("╮", GRADIENT_YELLOW)}`;
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

function lineWithSplitFooter(left: string, right: string, innerWidth: number): string {
  const plainLeft = stripAnsi(left);
  const plainRight = stripAnsi(right);
  const leftLen = charLength(plainLeft);
  const rightLen = charLength(plainRight);

  if (leftLen + rightLen + 1 > innerWidth) {
    return lineWithBorders(`${left} ${fitRight(plainRight, Math.max(1, innerWidth - leftLen - 1))}`, innerWidth);
  }

  const gap = " ".repeat(Math.max(1, innerWidth - leftLen - rightLen));
  return lineWithBorders(`${left}${gap}${right}`, innerWidth);
}

function highlightedRow(row: string): string {
  const chars = Array.from(row);
  if (chars.length === 0) return row;
  const first = bgColorText(chars[0] ?? "", FOCUS_ACCENT_BG, BLACK);
  const rest = chars.slice(1).join("");
  if (rest.length === 0) {
    return first;
  }
  return `${first}${horizontalGradientBackground(rest, GRADIENT_PINK, GRADIENT_YELLOW, BLACK)}`;
}

function buildModelRows(state: DownloaderState, contentWidth: number, rowCount: number): string[] {
  const rows: string[] = [];

  if (state.models.length === 0) {
    rows.push(colorText("No compatible models found for current RAM+VRAM.", WARNING_YELLOW));
    return rows;
  }

  const start = state.modelScrollOffset;
  const end = Math.min(state.models.length, start + rowCount);
  for (let index = start; index < end; index++) {
    const model = state.models[index];
    if (!model) continue;

    const prefix = index === state.selectedModelIndex ? ">" : " ";
    const leftWidth = Math.max(10, contentWidth - 35);
    const left = fitLeft(model.id, leftWidth);
    const stats = `↓${formatCount(model.downloads)} ♥${formatCount(model.likes)} ${formatSize(model.sizeBytes)} ${model.lastModified.slice(0, 10)}`;
    const row = `${prefix} ${left.padEnd(leftWidth, " ")} | ${fitRight(stats, 30)}`;
    rows.push(index === state.selectedModelIndex ? highlightedRow(row) : row);
  }

  return rows;
}

function buildFileRows(state: DownloaderState, contentWidth: number, rowCount: number): string[] {
  const rows: string[] = [];
  if (state.files.length === 0) {
    rows.push(colorText("No GGUF files found for this model.", WARNING_YELLOW));
    return rows;
  }

  const start = state.fileScrollOffset;
  const end = Math.min(state.files.length, start + rowCount);
  for (let index = start; index < end; index++) {
    const file = state.files[index];
    if (!file) continue;

    const prefix = index === state.selectedFileIndex ? ">" : " ";
    const basename = file.path.includes("/")
      ? (file.path.split("/").pop() ?? file.path)
      : file.path;
    const leftWidth = Math.max(8, contentWidth - 34);
    const left = fitLeft(basename, leftWidth);
    const detail = `${file.quant} ${formatSize(file.sizeBytes)} ${file.reason}`;
    const row = `${prefix} ${left.padEnd(leftWidth, " ")} | ${fitRight(detail, 29)}`;
    if (index === state.selectedFileIndex) {
      rows.push(highlightedRow(row));
      continue;
    }
    rows.push(colorText(row, file.canRun ? SUCCESS_GREEN : ERROR_RED));
  }

  return rows;
}

function fillRows(rows: string[], rowCount: number): string[] {
  if (rows.length >= rowCount) {
    return rows.slice(0, rowCount);
  }
  return [...rows, ...new Array<string>(rowCount - rows.length).fill("")];
}

function buildProgressBar(
  innerWidth: number,
  bytesDownloaded: number,
  totalBytes: number | null
): string {
  if (totalBytes === null || totalBytes <= 0) {
    return "Progress: downloading...";
  }

  const suffix = ` ${((bytesDownloaded / totalBytes) * 100).toFixed(1)}%`;
  const barWidth = Math.max(1, innerWidth - suffix.length - 2);
  const progress = Math.max(0, Math.min(1, bytesDownloaded / totalBytes));
  const filled = Math.round(barWidth * progress);
  const empty = Math.max(0, barWidth - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]${suffix}`;
}

function buildDownloadingRows(
  state: DownloaderState,
  innerWidth: number
): string[] {
  if (!state.download) {
    return [`Loading: ${state.loadingMessage}`];
  }

  const filename = state.download.filename.includes("/")
    ? (state.download.filename.split("/").pop() ?? state.download.filename)
    : state.download.filename;

  const rows: string[] = [];
  rows.push(
    colorText(
      `Downloading ${fitLeft(filename, Math.max(1, innerWidth - 12))}`,
      GRADIENT_BLUE
    )
  );
  rows.push(
    colorText(
      buildProgressBar(innerWidth, state.download.bytesDownloaded, state.download.totalBytes),
      SUCCESS_GREEN
    )
  );
  return rows;
}

export function renderDownloaderLines(options: DownloaderRenderOptions): string[] {
  const width = Math.max(20, options.width);
  const state = options.state;
  const innerWidth = Math.max(1, width - 2);

  const rows: string[] = [];
  rows.push(makeBorderTop(width));

  if (state.phase !== "downloading") {
    const tabs = [
      tabText("Most Downloaded", state.tab),
      tabText("Top Rated", state.tab),
      tabText("Newest", state.tab)
    ].join(" ");
    const memText = `RAM+VRAM: ${state.totalMemoryGb.toFixed(1)}GB | Disk: ${state.diskFreeGb.toFixed(1)}GB`;
    const tabsWidth = Math.max(1, innerWidth - 32);
    let tabsCell = tabs;
    if (charLength(tabsCell) > tabsWidth) {
      tabsCell = fitLeft(" Most Downloaded   Top Rated   Newest ", tabsWidth);
    }
    const tabsPadding = " ".repeat(Math.max(0, tabsWidth - charLength(tabsCell)));
    rows.push(lineWithBorders(`${tabsCell}${tabsPadding} ${fitRight(memText, 31)}`, innerWidth));
  }

  let bodyRows: string[] = [];
  if (state.view === "models") {
    if (state.phase === "loading-models") {
      bodyRows = fillRows([`Loading: ${state.loadingMessage}`], DOWNLOADER_MODEL_BODY_ROWS);
    } else if (state.phase === "error" && state.errorMessage.length > 0) {
      bodyRows = fillRows([`Error: ${state.errorMessage}`], DOWNLOADER_MODEL_BODY_ROWS);
    } else {
      bodyRows = fillRows(
        buildModelRows(state, innerWidth, DOWNLOADER_MODEL_BODY_ROWS),
        DOWNLOADER_MODEL_BODY_ROWS
      );
    }
  } else if (state.phase === "downloading") {
    bodyRows = buildDownloadingRows(state, innerWidth);
  } else if (state.phase === "loading-files") {
    bodyRows = fillRows([`Loading: ${state.loadingMessage}`], DOWNLOADER_FILE_BODY_ROWS);
  } else if (state.phase === "error" && state.errorMessage.length > 0) {
    bodyRows = fillRows([`Error: ${state.errorMessage}`], DOWNLOADER_FILE_BODY_ROWS);
  } else {
    const fileRows = [
      colorText(
        `Files for ${fitLeft(state.selectedRepoId, Math.max(1, innerWidth - 10))}`,
        GRADIENT_BLUE
      ),
      ...buildFileRows(state, innerWidth, DOWNLOADER_FILE_BODY_ROWS - 1)
    ];
    bodyRows = fillRows(fileRows, DOWNLOADER_FILE_BODY_ROWS);
  }

  rows.push(...bodyRows.map((row) => lineWithBorders(row, innerWidth)));

  if (state.phase === "downloading") {
    const status = state.download?.statusText ?? "Downloading...";
    rows.push(lineWithSplitFooter("[Esc] Cancel", fitRight(status, innerWidth - 14), innerWidth));
  } else {
    const footer =
      state.view === "models"
        ? "[Enter] Select  [↑/↓] Move  [←/→] Sort  [Esc] Close"
        : "[Enter] Download  [↑/↓] Move  [Esc] Back";
    rows.push(lineWithBorders(footer, innerWidth));
  }
  rows.push(makeBorderBottom(width));

  return rows;
}
