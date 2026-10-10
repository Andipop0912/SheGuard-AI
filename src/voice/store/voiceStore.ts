import { create } from 'zustand';
import { VoiceDetectionState } from '../domain/VoiceDetectionState';
import { VoiceTriggerPayload } from '../domain/VoiceTriggerPayload';
import { AppContainer } from '../../app/di/AppContainer';
import { ensureVoicePermissions } from '../native/voicePermissions';

interface VoiceStoreState {
  voiceState: VoiceDetectionState;
  isListening: boolean;
  lastPayload: VoiceTriggerPayload | null;

  startVoiceListening: () => Promise<boolean>;
  stopVoiceListening: () => Promise<boolean>;
  simulateVoiceKeyword: () => Promise<void>;
  resetVoiceState: () => void;
}

let unsubscribeVoiceState: (() => void) | null = null;
let unsubscribeVoicePayload: (() => void) | null = null;

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  voiceState: VoiceDetectionState.DISABLED,
  isListening: false,
  lastPayload: null,

  startVoiceListening: async () => {
    const container = AppContainer.getInstance();
    const adapter = container.voiceActivationAdapter;

    // The native service is a microphone foreground service; starting it without
    // RECORD_AUDIO crashes on Android 14+. Without permission, voice stays DISABLED.
    if ((await ensureVoicePermissions()) !== 'granted') {
      set({ voiceState: VoiceDetectionState.DISABLED, isListening: false });
      return false;
    }

    if (unsubscribeVoiceState) unsubscribeVoiceState();
    if (unsubscribeVoicePayload) unsubscribeVoicePayload();

    unsubscribeVoiceState = adapter.subscribeState((state) => {
      set({ voiceState: state, isListening: adapter.isVoiceMonitoringActive() });
    });

    unsubscribeVoicePayload = adapter.subscribeTriggerPayload((payload) => {
      set({ lastPayload: payload });
    });

    const success = await adapter.startListening();
    set({ isListening: success });
    return success;
  },

  stopVoiceListening: async () => {
    const container = AppContainer.getInstance();
    const adapter = container.voiceActivationAdapter;
    const success = await adapter.stopListening();

    if (unsubscribeVoiceState) {
      unsubscribeVoiceState();
      unsubscribeVoiceState = null;
    }
    if (unsubscribeVoicePayload) {
      unsubscribeVoicePayload();
      unsubscribeVoicePayload = null;
    }

    set({ voiceState: VoiceDetectionState.DISABLED, isListening: false });
    return success;
  },

  simulateVoiceKeyword: async () => {
    const container = AppContainer.getInstance();
    await container.voiceActivationAdapter.simulateVoiceTrigger();
  },

  resetVoiceState: () => {
    set({
      voiceState: VoiceDetectionState.DISABLED,
      isListening: false,
      lastPayload: null,
    });
  },
}));
