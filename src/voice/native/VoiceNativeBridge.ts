import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { VoiceTriggerPayload } from '../domain/VoiceTriggerPayload';
import { VoiceDetectionState } from '../domain/VoiceDetectionState';

const { SheGuardVoiceModule } = NativeModules;

export interface VoiceNativeInterface {
  startVoiceDetection(): Promise<boolean>;
  stopVoiceDetection(): Promise<boolean>;
  isVoiceDetectionRunning(): Promise<boolean>;
  getVoiceState(): Promise<VoiceDetectionState>;
  onVoiceTriggerDetected(callback: (payload: VoiceTriggerPayload) => void): () => void;
  onVoiceStateChanged(callback: (state: VoiceDetectionState) => void): () => void;
}

export class VoiceNativeModule implements VoiceNativeInterface {
  private eventEmitter: NativeEventEmitter | null = null;
  private mockTriggerListeners: Set<(payload: VoiceTriggerPayload) => void> = new Set();
  private mockStateListeners: Set<(state: VoiceDetectionState) => void> = new Set();
  private currentState: VoiceDetectionState = VoiceDetectionState.DISABLED;

  constructor() {
    if (Platform.OS === 'android' && SheGuardVoiceModule) {
      this.eventEmitter = new NativeEventEmitter(SheGuardVoiceModule);
    }
  }

  public async startVoiceDetection(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardVoiceModule) {
      this.currentState = VoiceDetectionState.LISTENING;
      this.notifyMockState(VoiceDetectionState.LISTENING);
      return true;
    }
    try {
      return await SheGuardVoiceModule.startVoiceDetection();
    } catch {
      this.currentState = VoiceDetectionState.ERROR;
      this.notifyMockState(VoiceDetectionState.ERROR);
      return false;
    }
  }

  public async stopVoiceDetection(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardVoiceModule) {
      this.currentState = VoiceDetectionState.DISABLED;
      this.notifyMockState(VoiceDetectionState.DISABLED);
      return true;
    }
    try {
      return await SheGuardVoiceModule.stopVoiceDetection();
    } catch {
      return false;
    }
  }

  public async isVoiceDetectionRunning(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardVoiceModule) {
      return this.currentState === VoiceDetectionState.LISTENING || this.currentState === VoiceDetectionState.COOLDOWN;
    }
    try {
      return await SheGuardVoiceModule.isVoiceDetectionRunning();
    } catch {
      return false;
    }
  }

  public async getVoiceState(): Promise<VoiceDetectionState> {
    if (Platform.OS !== 'android' || !SheGuardVoiceModule) {
      return this.currentState;
    }
    try {
      const stateStr = await SheGuardVoiceModule.getVoiceState();
      return (stateStr as VoiceDetectionState) ?? VoiceDetectionState.DISABLED;
    } catch {
      return VoiceDetectionState.ERROR;
    }
  }

  public onVoiceTriggerDetected(callback: (payload: VoiceTriggerPayload) => void): () => void {
    if (this.eventEmitter) {
      const subscription = this.eventEmitter.addListener('VOICE_TRIGGER_DETECTED', (event: { payloadJson: string }) => {
        try {
          const parsed: VoiceTriggerPayload = JSON.parse(event.payloadJson);
          callback(parsed);
        } catch {
          // Safe JSON parse error suppression
        }
      });
      return () => subscription.remove();
    }

    this.mockTriggerListeners.add(callback);
    return () => {
      this.mockTriggerListeners.delete(callback);
    };
  }

  public onVoiceStateChanged(callback: (state: VoiceDetectionState) => void): () => void {
    if (this.eventEmitter) {
      const subscription = this.eventEmitter.addListener('VOICE_STATE_CHANGED', (event: { state: string }) => {
        const state = (event.state as VoiceDetectionState) ?? VoiceDetectionState.DISABLED;
        callback(state);
      });
      return () => subscription.remove();
    }

    this.mockStateListeners.add(callback);
    callback(this.currentState);
    return () => {
      this.mockStateListeners.delete(callback);
    };
  }

  public simulateKeywordTrigger(customPayload?: Partial<VoiceTriggerPayload>): VoiceTriggerPayload {
    const payload: VoiceTriggerPayload = {
      triggerId: customPayload?.triggerId ?? `vt-${Date.now()}`,
      source: 'VOICE',
      timestamp: customPayload?.timestamp ?? Date.now(),
      keywordDetected: customPayload?.keywordDetected ?? 'sheguard emergency',
      confidence: customPayload?.confidence ?? 0.95,
      detectorSessionId: customPayload?.detectorSessionId ?? 'sim-session-01',
      metadata: {
        modelVersion: 'vosk-model-small-en-us-0.15',
        isBackground: false,
        ...customPayload?.metadata,
      },
    };

    if (Platform.OS === 'android' && SheGuardVoiceModule) {
      SheGuardVoiceModule.simulateKeywordTrigger().catch(() => {});
    } else {
      this.mockTriggerListeners.forEach((listener) => listener(payload));
    }

    return payload;
  }

  private notifyMockState(state: VoiceDetectionState): void {
    this.currentState = state;
    this.mockStateListeners.forEach((listener) => listener(state));
  }
}
