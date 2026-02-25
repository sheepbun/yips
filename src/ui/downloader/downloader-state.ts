import type { HfModelFile, HfModelSort, HfModelSummary } from "#models/model-downloader";

export type DownloaderTab = "Most Downloaded" | "Top Rated" | "Newest";
export type DownloaderView = "models" | "files";
export type DownloaderPhase = "idle" | "loading-models" | "loading-files" | "downloading" | "error";

export interface DownloaderDownloadState {
  repoId: string;
  filename: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  startedAtMs: number;
  lastUpdateAtMs: number;
  statusText: string;
}

export const DOWNLOADER_TABS: readonly DownloaderTab[] = ["Most Downloaded", "Top Rated", "Newest"];

export interface DownloaderState {
  isOpen: boolean;
  view: DownloaderView;
  tab: DownloaderTab;
  searchQuery: string;
  models: HfModelSummary[];
  files: HfModelFile[];
  selectedModelIndex: number;
  selectedFileIndex: number;
  modelScrollOffset: number;
  fileScrollOffset: number;
  phase: DownloaderPhase;
  loading: boolean;
  loadingMessage: string;
  errorMessage: string;
  download: DownloaderDownloadState | null;
  selectedRepoId: string;
  ramGb: number;
  vramGb: number;
  totalMemoryGb: number;
  diskFreeGb: number;
  cacheQuery: string;
  modelCacheByTab: Partial<Record<DownloaderTab, HfModelSummary[]>>;
  preloadingTabs: boolean;
  cancelConfirmOpen: boolean;
}

export function tabToSort(tab: DownloaderTab): HfModelSort {
  if (tab === "Top Rated") {
    return "trendingScore";
  }
  if (tab === "Newest") {
    return "lastModified";
  }
  return "downloads";
}

export function createDownloaderState(memory: {
  ramGb: number;
  vramGb: number;
  totalMemoryGb: number;
  diskFreeGb?: number;
}): DownloaderState {
  return {
    isOpen: true,
    view: "models",
    tab: "Most Downloaded",
    searchQuery: "",
    models: [],
    files: [],
    selectedModelIndex: 0,
    selectedFileIndex: 0,
    modelScrollOffset: 0,
    fileScrollOffset: 0,
    phase: "idle",
    loading: false,
    loadingMessage: "Loading models...",
    errorMessage: "",
    download: null,
    selectedRepoId: "",
    ramGb: memory.ramGb,
    vramGb: memory.vramGb,
    totalMemoryGb: memory.totalMemoryGb,
    diskFreeGb: memory.diskFreeGb ?? 0,
    cacheQuery: "",
    modelCacheByTab: {},
    preloadingTabs: false,
    cancelConfirmOpen: false
  };
}

export function cycleTab(state: DownloaderState, direction: -1 | 1): DownloaderState {
  const currentIndex = DOWNLOADER_TABS.indexOf(state.tab);
  const nextIndex = (currentIndex + direction + DOWNLOADER_TABS.length) % DOWNLOADER_TABS.length;
  return {
    ...state,
    tab: DOWNLOADER_TABS[nextIndex] ?? "Most Downloaded",
    selectedModelIndex: 0,
    modelScrollOffset: 0
  };
}

export function setModels(state: DownloaderState, models: HfModelSummary[]): DownloaderState {
  return {
    ...state,
    models,
    selectedModelIndex:
      models.length > 0 ? Math.min(state.selectedModelIndex, models.length - 1) : 0,
    modelScrollOffset: 0,
    phase: "idle",
    loading: false,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function setFiles(
  state: DownloaderState,
  repoId: string,
  files: HfModelFile[]
): DownloaderState {
  return {
    ...state,
    selectedRepoId: repoId,
    view: "files",
    files,
    selectedFileIndex: 0,
    fileScrollOffset: 0,
    phase: "idle",
    loading: false,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function setLoading(state: DownloaderState, message: string): DownloaderState {
  return {
    ...state,
    phase: "loading-models",
    loading: true,
    loadingMessage: message,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function setLoadingModels(state: DownloaderState, message: string): DownloaderState {
  return {
    ...state,
    phase: "loading-models",
    loading: true,
    loadingMessage: message,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function setLoadingFiles(state: DownloaderState, message: string): DownloaderState {
  return {
    ...state,
    phase: "loading-files",
    loading: true,
    loadingMessage: message,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function startDownload(
  state: DownloaderState,
  repoId: string,
  filename: string,
  statusText: string
): DownloaderState {
  const now = Date.now();
  return {
    ...state,
    phase: "downloading",
    loading: true,
    loadingMessage: statusText,
    errorMessage: "",
    download: {
      repoId,
      filename,
      bytesDownloaded: 0,
      totalBytes: null,
      startedAtMs: now,
      lastUpdateAtMs: now,
      statusText
    },
    cancelConfirmOpen: false
  };
}

export function updateDownloadProgress(
  state: DownloaderState,
  update: {
    bytesDownloaded: number;
    totalBytes: number | null;
    statusText: string;
  }
): DownloaderState {
  if (state.phase !== "downloading" || !state.download) {
    return state;
  }
  return {
    ...state,
    loadingMessage: update.statusText,
    download: {
      ...state.download,
      bytesDownloaded: Math.max(0, update.bytesDownloaded),
      totalBytes: update.totalBytes,
      lastUpdateAtMs: Date.now(),
      statusText: update.statusText
    }
  };
}

export function finishDownload(state: DownloaderState): DownloaderState {
  return {
    ...state,
    phase: "idle",
    loading: false,
    loadingMessage: "",
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function setPreloadingTabs(
  state: DownloaderState,
  preloadingTabs: boolean
): DownloaderState {
  return {
    ...state,
    preloadingTabs
  };
}

export function setCachedModels(
  state: DownloaderState,
  tab: DownloaderTab,
  query: string,
  models: HfModelSummary[]
): DownloaderState {
  const normalizedQuery = query.trim();
  const cache = state.cacheQuery === normalizedQuery ? state.modelCacheByTab : {};

  return {
    ...state,
    cacheQuery: normalizedQuery,
    modelCacheByTab: {
      ...cache,
      [tab]: models
    }
  };
}

export function getCachedModels(
  state: DownloaderState,
  tab: DownloaderTab,
  query: string
): HfModelSummary[] | null {
  if (state.cacheQuery !== query.trim()) {
    return null;
  }
  return state.modelCacheByTab[tab] ?? null;
}

export function resetModelCache(state: DownloaderState, query: string): DownloaderState {
  return {
    ...state,
    cacheQuery: query.trim(),
    modelCacheByTab: {}
  };
}

export function setError(state: DownloaderState, message: string): DownloaderState {
  return {
    ...state,
    phase: "error",
    loading: false,
    errorMessage: message,
    download: null,
    cancelConfirmOpen: false
  };
}

export function setDownloaderError(state: DownloaderState, message: string): DownloaderState {
  return {
    ...state,
    phase: "error",
    loading: false,
    errorMessage: message,
    download: null,
    cancelConfirmOpen: false
  };
}

export function closeFileView(state: DownloaderState): DownloaderState {
  return {
    ...state,
    view: "models",
    files: [],
    selectedFileIndex: 0,
    fileScrollOffset: 0,
    phase: "idle",
    loading: false,
    errorMessage: "",
    download: null,
    cancelConfirmOpen: false
  };
}

export function openCancelConfirm(state: DownloaderState): DownloaderState {
  if (state.phase !== "downloading" || !state.download) {
    return state;
  }
  return {
    ...state,
    cancelConfirmOpen: true
  };
}

export function closeCancelConfirm(state: DownloaderState): DownloaderState {
  if (!state.cancelConfirmOpen) {
    return state;
  }
  return {
    ...state,
    cancelConfirmOpen: false
  };
}

export function moveModelSelection(
  state: DownloaderState,
  delta: -1 | 1,
  windowSize: number
): DownloaderState {
  if (state.models.length === 0) {
    return state;
  }

  const max = state.models.length - 1;
  const nextIndex = Math.max(0, Math.min(max, state.selectedModelIndex + delta));
  let nextOffset = state.modelScrollOffset;
  if (nextIndex < nextOffset) {
    nextOffset = nextIndex;
  }
  if (nextIndex >= nextOffset + windowSize) {
    nextOffset = nextIndex - windowSize + 1;
  }

  return {
    ...state,
    selectedModelIndex: nextIndex,
    modelScrollOffset: Math.max(0, nextOffset)
  };
}

export function moveFileSelection(
  state: DownloaderState,
  delta: -1 | 1,
  windowSize: number
): DownloaderState {
  if (state.files.length === 0) {
    return state;
  }

  const max = state.files.length - 1;
  const nextIndex = Math.max(0, Math.min(max, state.selectedFileIndex + delta));
  let nextOffset = state.fileScrollOffset;
  if (nextIndex < nextOffset) {
    nextOffset = nextIndex;
  }
  if (nextIndex >= nextOffset + windowSize) {
    nextOffset = nextIndex - windowSize + 1;
  }

  return {
    ...state,
    selectedFileIndex: nextIndex,
    fileScrollOffset: Math.max(0, nextOffset)
  };
}
