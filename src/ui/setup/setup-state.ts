import type { GatewayChannel } from "#types/app-types";

export const SETUP_CHANNELS: readonly GatewayChannel[] = ["whatsapp", "telegram", "discord"];

export interface SetupState {
  selectedChannelIndex: number;
  editingChannel: GatewayChannel | null;
}

export function createSetupState(): SetupState {
  return {
    selectedChannelIndex: 0,
    editingChannel: null
  };
}

export function moveSetupSelection(state: SetupState, delta: -1 | 1): SetupState {
  const total = SETUP_CHANNELS.length;
  return {
    ...state,
    selectedChannelIndex: (state.selectedChannelIndex + delta + total) % total
  };
}

export function getSelectedSetupChannel(state: SetupState): GatewayChannel {
  return SETUP_CHANNELS[state.selectedChannelIndex] ?? "whatsapp";
}
