import {
  bgColorText,
  colorText,
  GRADIENT_BLUE,
  GRADIENT_PINK,
  GRADIENT_YELLOW,
  horizontalGradient,
  horizontalGradientAtOffset,
  horizontalGradientBackground,
  stripAnsi,
  WARNING_YELLOW,
  type Rgb
} from "#ui/colors";
import type { ModelManagerState } from "#ui/model-manager/model-manager-state";

const TAB_INACTIVE: Rgb = { r: 0x88, g: 0x88, b: 0x88 };
const BLACK: Rgb = { r: 0x00, g: 0x00, b: 0x00 };
const CURRENT_MODEL_BLUE: Rgb = { r: 0x89, g: 0xcf, b: 0xf0 };
const FOCUS_ACCENT_BG: Rgb = { r: 0xff, g: 0xcc, b: 0xff };
const MODEL_MANAGER_BODY_ROWS = 12;
const ANSI_BOLD_ON = "\u001b[1m";
const ANSI_BOLD_OFF = "\u001b[22m";

interface ModelManagerRenderOptions {
  width: number;
  state: ModelManagerState;
  currentModel: string;
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

function fitRight(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) {
    return text;
  }
  return chars.slice(chars.length - width).join("");
}

function makeBorderTop(width: number): string {
  if (width <= 1) return "╭";

  const prefix = "╭─── ";
  const titleBrand = "Yips";
  const titleDetail = " Model Manager";
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

function toSizeCell(sizeGb: number): string {
  return `${sizeGb.toFixed(1)}G`;
}

function getFileName(modelId: string): string {
  const parts = modelId.split("/");
  return parts[parts.length - 1] ?? modelId;
}

function buildModelRows(
  state: ModelManagerState,
  contentWidth: number,
  rowCount: number,
  currentModel: string
): string[] {
  if (state.models.length === 0) {
    return [colorText("No models found in local models directory.", WARNING_YELLOW)];
  }

  const markerWidth = 3;
  const separators = 4 * 3;
  const minBackendWidth = 9;
  const minProviderWidth = 14;
  const minNameWidth = 16;
  const minFileWidth = 18;
  const minSizeWidth = 7;

  let backendWidth = minBackendWidth;
  let providerWidth = minProviderWidth;
  let nameWidth = minNameWidth;
  let fileWidth = minFileWidth;
  let sizeWidth = minSizeWidth;

  const minimumTotalColumnWidth =
    minBackendWidth + minProviderWidth + minNameWidth + minFileWidth + minSizeWidth;
  const availableTotalColumnWidth = Math.max(5, contentWidth - markerWidth - separators);

  if (availableTotalColumnWidth >= minimumTotalColumnWidth) {
    const extra = availableTotalColumnWidth - minimumTotalColumnWidth;
    const growBy = Math.floor(extra / 5);
    const remainder = extra % 5;
    backendWidth += growBy + (remainder > 0 ? 1 : 0);
    providerWidth += growBy + (remainder > 1 ? 1 : 0);
    nameWidth += growBy + (remainder > 2 ? 1 : 0);
    fileWidth += growBy + (remainder > 3 ? 1 : 0);
    sizeWidth += growBy;
  } else {
    const minAllowed: [number, number, number, number, number] = [4, 6, 8, 8, 4];
    const widths: [number, number, number, number, number] = [
      backendWidth,
      providerWidth,
      nameWidth,
      fileWidth,
      sizeWidth
    ];
    const reduceOrder: Array<0 | 1 | 2 | 3 | 4> = [3, 2, 1, 0, 4];
    let deficit = minimumTotalColumnWidth - availableTotalColumnWidth;

    while (deficit > 0) {
      let reducedThisPass = false;
      for (const index of reduceOrder) {
        if (deficit <= 0) {
          break;
        }
        if (widths[index] > minAllowed[index]) {
          widths[index] -= 1;
          deficit -= 1;
          reducedThisPass = true;
        }
      }
      if (!reducedThisPass) {
        break;
      }
    }

    [backendWidth, providerWidth, nameWidth, fileWidth, sizeWidth] = widths;
  }

  const rows: string[] = [];
  const header = `   ${"Backend".padEnd(backendWidth, " ")} | ${"Provider".padEnd(providerWidth, " ")} | ${"Name".padEnd(nameWidth, " ")} | ${"File".padEnd(fileWidth, " ")} | ${"Size".padStart(sizeWidth, " ")}`;
  rows.push(horizontalGradient(header, GRADIENT_PINK, GRADIENT_YELLOW));

  const visibleRowCount = Math.max(0, rowCount - 1);
  const start = state.scrollOffset;
  const end = Math.min(state.models.length, start + visibleRowCount);

  for (let index = start; index < end; index++) {
    const model = state.models[index];
    if (!model) continue;

    const selected = index === state.selectedModelIndex;
    const current = model.id === currentModel;

    const prefix = `${selected ? ">" : " "}${current ? "*" : " "} `;
    const backend = fitLeft(model.friendlyBackend, backendWidth).padEnd(backendWidth, " ");
    const provider = fitLeft(model.host, providerWidth).padEnd(providerWidth, " ");
    const name = fitLeft(model.friendlyName, nameWidth).padEnd(nameWidth, " ");
    const file = fitLeft(getFileName(model.id), fileWidth).padEnd(fileWidth, " ");
    const sizeCell = toSizeCell(model.sizeGb).padStart(sizeWidth, " ");

    const row = `${prefix}${backend} | ${provider} | ${name} | ${file} | ${sizeCell}`;
    if (selected) {
      rows.push(highlightedRow(row));
      continue;
    }

    rows.push(current ? colorText(row, CURRENT_MODEL_BLUE) : row);
  }

  return rows;
}

function fillRows(rows: string[], rowCount: number): string[] {
  if (rows.length >= rowCount) {
    return rows.slice(0, rowCount);
  }
  return [...rows, ...new Array<string>(rowCount - rows.length).fill("")];
}

export function renderModelManagerLines(options: ModelManagerRenderOptions): string[] {
  const width = Math.max(20, options.width);
  const innerWidth = Math.max(1, width - 2);
  const rows: string[] = [];

  rows.push(makeBorderTop(width));

  const leftLabel = colorText(" Local ", TAB_INACTIVE);
  const specText = `RAM: ${options.state.ramGb.toFixed(1)}GB | VRAM: ${options.state.vramGb.toFixed(1)}GB`;
  const gap = Math.max(1, innerWidth - charLength(leftLabel) - charLength(specText));
  rows.push(
    lineWithBorders(
      `${leftLabel}${" ".repeat(gap)}${fitRight(specText, Math.max(1, innerWidth - charLength(leftLabel) - 1))}`,
      innerWidth
    )
  );

  let bodyRows: string[];
  if (options.state.phase === "loading") {
    bodyRows = fillRows([`Loading: ${options.state.loadingMessage}`], MODEL_MANAGER_BODY_ROWS);
  } else if (options.state.phase === "error" && options.state.errorMessage.length > 0) {
    bodyRows = fillRows([`Error: ${options.state.errorMessage}`], MODEL_MANAGER_BODY_ROWS);
  } else {
    bodyRows = fillRows(
      buildModelRows(options.state, innerWidth, MODEL_MANAGER_BODY_ROWS, options.currentModel),
      MODEL_MANAGER_BODY_ROWS
    );
  }

  rows.push(...bodyRows.map((row) => lineWithBorders(row, innerWidth)));
  rows.push(
    lineWithBorders(
      horizontalGradient(
        "[Enter] Select  [↑/↓] Move  [Del] Delete Local  [T] Downloader  [Esc] Close",
        GRADIENT_PINK,
        GRADIENT_YELLOW
      ),
      innerWidth
    )
  );
  rows.push(makeBorderBottom(width));

  return rows;
}
