import {
  bgColorText,
  colorText,
  ERROR_RED,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  horizontalGradientAtOffset,
  horizontalGradientBackground,
  stripAnsi,
  SUCCESS_GREEN,
  WARNING_YELLOW,
  type Rgb
} from "#ui/colors";
import type { DownloaderState, DownloaderTab } from "#ui/downloader/downloader-state";
const TAB_INACTIVE: Rgb = { r: 0x88, g: 0x88, b: 0x88 };
const BLACK: Rgb = { r: 0x00, g: 0x00, b: 0x00 };
const FOCUS_ACCENT_BG: Rgb = { r: 0xff, g: 0xcc, b: 0xff };
const DOWNLOADER_MODEL_BODY_ROWS = 10;
const DOWNLOADER_FILE_BODY_ROWS = 10;
const ANSI_BOLD_ON = "\u001b[1m";
const ANSI_BOLD_OFF = "\u001b[22m";

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
    return `${ANSI_BOLD_ON}${horizontalGradientBackground(label, GRADIENT_PINK, GRADIENT_YELLOW, BLACK)}${ANSI_BOLD_OFF}`;
  }
  return `${ANSI_BOLD_ON}${colorText(label, TAB_INACTIVE)}${ANSI_BOLD_OFF}`;
}

function makeBorderTop(width: number): string {
  if (width <= 1) return "╭";

  const prefix = "╭─── ";
  const titleBrand = "Yips";
  const titleDetail = " Model Downloader";
  const titleTail = " ";
  const prefixLen = charLength(prefix);
  const titleBrandLen = charLength(titleBrand);
  const titleDetailLen = charLength(titleDetail);
  const titleTailLen = charLength(titleTail);
  const plainTitleLen = prefixLen + titleBrandLen + titleDetailLen + titleTailLen;
  const fill = "─".repeat(Math.max(0, width - plainTitleLen - 1));
  const fillOffset = prefixLen + titleBrandLen + titleDetailLen + titleTailLen;
  const cornerOffset = width - 1;
  return `${horizontalGradientAtOffset(prefix, GRADIENT_PINK, GRADIENT_YELLOW, 0, width)}${ANSI_BOLD_ON}${horizontalGradient(titleBrand, GRADIENT_PINK, GRADIENT_YELLOW)}${colorText(titleDetail, GRADIENT_BLUE)}${ANSI_BOLD_OFF}${horizontalGradientAtOffset(titleTail, GRADIENT_PINK, GRADIENT_YELLOW, prefixLen + titleBrandLen + titleDetailLen, width)}${horizontalGradientAtOffset(fill, GRADIENT_PINK, GRADIENT_YELLOW, fillOffset, width)}${horizontalGradientAtOffset("╮", GRADIENT_PINK, GRADIENT_YELLOW, cornerOffset, width)}`;
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

function composeSplitFooter(left: string, right: string, innerWidth: number): string {
  const leftLen = charLength(left);
  const rightLen = charLength(right);

  if (leftLen + rightLen + 1 > innerWidth) {
    return `${left} ${fitRight(right, Math.max(1, innerWidth - leftLen - 1))}`;
  }

  const gap = " ".repeat(Math.max(1, innerWidth - leftLen - rightLen));
  return `${left}${gap}${right}`;
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

  const dlWidth = 9;
  const likesWidth = 6;
  const sizeWidth = 5;
  const dateWidth = 10;
  const staticWidth = 2 + 3 + dlWidth + 3 + likesWidth + 3 + sizeWidth + 3 + dateWidth;
  const modelWidth = Math.max(8, contentWidth - staticWidth);

  const header = `  ${"Model".padEnd(modelWidth, " ")} | ${"Downloads".padStart(dlWidth, " ")} | ${"Likes".padStart(likesWidth, " ")} | ${"Size".padStart(sizeWidth, " ")} | ${"Updated".padStart(dateWidth, " ")}`;
  rows.push(horizontalGradient(header, GRADIENT_PINK, GRADIENT_YELLOW));

  const visibleRowCount = Math.max(0, rowCount - 1);
  const start = state.modelScrollOffset;
  const end = Math.min(state.models.length, start + visibleRowCount);
  for (let index = start; index < end; index++) {
    const model = state.models[index];
    if (!model) continue;

    const prefix = index === state.selectedModelIndex ? ">" : " ";
    const modelCell = fitLeft(model.id, modelWidth).padEnd(modelWidth, " ");
    const downloadsCell = `${formatCount(model.downloads)}↓`.padStart(dlWidth, " ");
    const likesCell = `${formatCount(model.likes)}♥`.padStart(likesWidth, " ");
    const sizeCell = formatSize(model.sizeBytes).padStart(sizeWidth, " ");
    const dateCell = model.lastModified.slice(0, 10).padStart(dateWidth, " ");
    const row = `${prefix} ${modelCell} | ${downloadsCell} | ${likesCell} | ${sizeCell} | ${dateCell}`;
    rows.push(index === state.selectedModelIndex ? highlightedRow(row) : row);
  }

  return rows;
}

function toFileFitLabel(state: DownloaderState, file: DownloaderState["files"][number]): string {
  if (!file.canRun) {
    return file.reason;
  }

  if (file.sizeBytes === null || file.sizeBytes <= 0) {
    return file.reason;
  }

  if (!Number.isFinite(state.vramGb) || state.vramGb <= 0) {
    return file.reason;
  }

  const vramBytes = state.vramGb * 1024 ** 3;
  return file.sizeBytes <= vramBytes ? "Fits on GPU" : "Fits on GPU+CPU";
}

function buildFileRows(state: DownloaderState, contentWidth: number, rowCount: number): string[] {
  const rows: string[] = [];
  if (state.files.length === 0) {
    rows.push(colorText("No GGUF files found for this model.", WARNING_YELLOW));
    return rows;
  }

  const quantWidth = 21;
  const sizeWidth = 5;
  const fitWidth = 16;
  const staticWidth = 2 + 3 + quantWidth + 3 + sizeWidth + 3 + fitWidth;
  const fileWidth = Math.max(8, contentWidth - staticWidth);
  const header = `  ${"File".padEnd(fileWidth, " ")} | ${"Quant".padEnd(quantWidth, " ")} | ${"Size".padStart(sizeWidth, " ")} | ${"Fit".padEnd(fitWidth, " ")}`;
  rows.push(horizontalGradient(header, GRADIENT_PINK, GRADIENT_YELLOW));

  const visibleRowCount = Math.max(0, rowCount - 1);
  const start = state.fileScrollOffset;
  const end = Math.min(state.files.length, start + visibleRowCount);
  for (let index = start; index < end; index++) {
    const file = state.files[index];
    if (!file) continue;

    const prefix = index === state.selectedFileIndex ? ">" : " ";
    const basename = file.path.includes("/")
      ? (file.path.split("/").pop() ?? file.path)
      : file.path;
    const fileCell = fitLeft(basename, fileWidth).padEnd(fileWidth, " ");
    const quantCell = fitLeft(file.quant, quantWidth).padEnd(quantWidth, " ");
    const sizeCell = formatSize(file.sizeBytes).padStart(sizeWidth, " ");
    const fitCell = fitLeft(toFileFitLabel(state, file), fitWidth).padEnd(fitWidth, " ");
    const row = `${prefix} ${fileCell} | ${quantCell} | ${sizeCell} | ${fitCell}`;
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

function buildCancelConfirmRows(innerWidth: number): string[] {
  const message = fitLeft("Cancel download and delete partial file?", Math.max(1, innerWidth));
  return [colorText(message, WARNING_YELLOW), ""];
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
    const memText = `RAM: ${state.ramGb.toFixed(1)}GB | VRAM: ${state.vramGb.toFixed(1)}GB | Disk: ${state.diskFreeGb.toFixed(1)}GB`;
    const memWidth = Math.min(charLength(memText), Math.max(24, innerWidth - 10));
    const tabsWidth = Math.max(1, innerWidth - memWidth - 1);
    let tabsCell = tabs;
    if (charLength(tabsCell) > tabsWidth) {
      tabsCell = fitLeft(" Most Downloaded   Top Rated   Newest ", tabsWidth);
    }
    const tabsPadding = " ".repeat(Math.max(0, tabsWidth - charLength(tabsCell)));
    rows.push(lineWithBorders(`${tabsCell}${tabsPadding} ${fitRight(memText, memWidth)}`, innerWidth));
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
    bodyRows = state.cancelConfirmOpen
      ? buildCancelConfirmRows(innerWidth)
      : buildDownloadingRows(state, innerWidth);
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
    const left = state.cancelConfirmOpen ? "[Enter] Yes  [Esc] No" : "[Esc] Cancel";
    const statusWidth = Math.max(1, innerWidth - Array.from(left).length - 1);
    const footer = composeSplitFooter(left, fitRight(status, statusWidth), innerWidth);
    rows.push(lineWithBorders(horizontalGradient(footer, GRADIENT_PINK, GRADIENT_YELLOW), innerWidth));
  } else {
    const footer =
      state.view === "models"
        ? "[Enter] Select  [↑/↓] Move  [←/→] Sort  [Esc] Close"
        : "[Enter] Download  [↑/↓] Move  [Esc] Back";
    rows.push(lineWithBorders(horizontalGradient(footer, GRADIENT_PINK, GRADIENT_YELLOW), innerWidth));
  }
  rows.push(makeBorderBottom(width));

  return rows;
}
