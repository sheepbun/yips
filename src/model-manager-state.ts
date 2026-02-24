import { filterModels, type ModelManagerModel } from "./model-manager";

export type ModelManagerPhase = "idle" | "loading" | "error";

export interface ModelManagerState {
  isOpen: boolean;
  searchQuery: string;
  allModels: ModelManagerModel[];
  models: ModelManagerModel[];
  selectedModelIndex: number;
  scrollOffset: number;
  phase: ModelManagerPhase;
  loading: boolean;
  loadingMessage: string;
  errorMessage: string;
  ramGb: number;
  vramGb: number;
  totalMemoryGb: number;
}

export function createModelManagerState(memory: {
  ramGb: number;
  vramGb: number;
  totalMemoryGb: number;
}): ModelManagerState {
  return {
    isOpen: true,
    searchQuery: "",
    allModels: [],
    models: [],
    selectedModelIndex: 0,
    scrollOffset: 0,
    phase: "idle",
    loading: false,
    loadingMessage: "Loading models...",
    errorMessage: "",
    ramGb: memory.ramGb,
    vramGb: memory.vramGb,
    totalMemoryGb: memory.totalMemoryGb
  };
}

function clampSelection(state: ModelManagerState): ModelManagerState {
  const max = Math.max(0, state.models.length - 1);
  const selectedModelIndex = Math.min(Math.max(0, state.selectedModelIndex), max);
  const scrollOffset = Math.min(Math.max(0, state.scrollOffset), Math.max(0, max));

  return {
    ...state,
    selectedModelIndex,
    scrollOffset
  };
}

export function setModelManagerLoading(
  state: ModelManagerState,
  message: string
): ModelManagerState {
  return {
    ...state,
    phase: "loading",
    loading: true,
    loadingMessage: message,
    errorMessage: ""
  };
}

export function setModelManagerError(state: ModelManagerState, message: string): ModelManagerState {
  return {
    ...state,
    phase: "error",
    loading: false,
    errorMessage: message
  };
}

export function setModelManagerModels(
  state: ModelManagerState,
  models: ModelManagerModel[]
): ModelManagerState {
  const filtered = filterModels(models, state.searchQuery);
  return clampSelection({
    ...state,
    allModels: models,
    models: filtered,
    phase: "idle",
    loading: false,
    errorMessage: "",
    selectedModelIndex:
      filtered.length > 0 ? Math.min(state.selectedModelIndex, filtered.length - 1) : 0,
    scrollOffset: 0
  });
}

export function setModelManagerSearchQuery(
  state: ModelManagerState,
  searchQuery: string
): ModelManagerState {
  const models = filterModels(state.allModels, searchQuery);
  return clampSelection({
    ...state,
    searchQuery,
    models,
    selectedModelIndex:
      models.length > 0 ? Math.min(state.selectedModelIndex, models.length - 1) : 0,
    scrollOffset: 0,
    phase: state.phase === "error" ? "idle" : state.phase,
    errorMessage: state.phase === "error" ? "" : state.errorMessage
  });
}

export function moveModelManagerSelection(
  state: ModelManagerState,
  delta: -1 | 1,
  viewportSize: number
): ModelManagerState {
  if (state.models.length === 0) {
    return state;
  }

  const max = state.models.length - 1;
  const nextIndex = Math.min(max, Math.max(0, state.selectedModelIndex + delta));

  let nextScroll = state.scrollOffset;
  if (nextIndex < nextScroll) {
    nextScroll = nextIndex;
  } else if (nextIndex >= nextScroll + viewportSize) {
    nextScroll = nextIndex - (viewportSize - 1);
  }

  return {
    ...state,
    selectedModelIndex: nextIndex,
    scrollOffset: Math.max(0, nextScroll)
  };
}

export function removeModelById(state: ModelManagerState, id: string): ModelManagerState {
  const allModels = state.allModels.filter((model) => model.id !== id);
  const models = filterModels(allModels, state.searchQuery);

  return clampSelection({
    ...state,
    allModels,
    models,
    selectedModelIndex:
      models.length > 0 ? Math.min(state.selectedModelIndex, models.length - 1) : 0,
    phase: "idle",
    loading: false,
    errorMessage: ""
  });
}

export function getSelectedModel(state: ModelManagerState): ModelManagerModel | null {
  if (state.models.length === 0) {
    return null;
  }

  return state.models[state.selectedModelIndex] ?? null;
}
