import { VoiceNativeModule, VoiceNativeInterface } from '../native/VoiceNativeBridge';
import { VoiceTriggerPayload } from '../domain/VoiceTriggerPayload';
import { VoiceDetectionState } from '../domain/VoiceDetectionState';
import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { getEventOwner } from '../../app/identity';

export class VoiceActivationAdapter {
  private nativeBridge: VoiceNativeInterface;
  private emergencyCoordinator: EmergencyCoordinator;
  private isListening = false;
  private currentState: VoiceDetectionState = VoiceDetectionState.DISABLED;

  private lastTriggerTime = 0;
  private static readonly COOLDOWN_MS = 5000;

  private stateListeners: Set<(state: VoiceDetectionState) => void> = new Set();
  private payloadListeners: Set<(payload: VoiceTriggerPayload) => void> = new Set();
  private unsubscribeNativeTrigger: (() => void) | null = null;
  private unsubscribeNativeState: (() => void) | null = null;

  constructor(
    emergencyCoordinator: EmergencyCoordinator,
    nativeBridge?: VoiceNativeInterface
  ) {
    this.emergencyCoordinator = emergencyCoordinator;
    this.nativeBridge = nativeBridge ?? new VoiceNativeModule();
  }

  public getVoiceState(): VoiceDetectionState {
    return this.currentState;
  }

  public isVoiceMonitoringActive(): boolean {
    return this.isListening;
  }

  public subscribeState(listener: (state: VoiceDetectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.currentState);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeTriggerPayload(listener: (payload: VoiceTriggerPayload) => void): () => void {
    this.payloadListeners.add(listener);
    return () => {
      this.payloadListeners.delete(listener);
    };
  }

  private updateState(state: VoiceDetectionState): void {
    this.currentState = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  public async startListening(): Promise<boolean> {
    if (this.isListening) {
      return true;
    }

    this.updateState(VoiceDetectionState.INITIALIZING);

    this.unsubscribeNativeTrigger = this.nativeBridge.onVoiceTriggerDetected((payload) => {
      this.handleVoiceKeywordDetected(payload);
    });

    this.unsubscribeNativeState = this.nativeBridge.onVoiceStateChanged((nativeState) => {
      this.updateState(nativeState);
    });

    const success = await this.nativeBridge.startVoiceDetection();
    if (success) {
      this.isListening = true;
      this.updateState(VoiceDetectionState.LISTENING);
    } else {
      this.isListening = false;
      this.updateState(VoiceDetectionState.ERROR);
    }

    return success;
  }

  public async stopListening(): Promise<boolean> {
    if (this.unsubscribeNativeTrigger) {
      this.unsubscribeNativeTrigger();
      this.unsubscribeNativeTrigger = null;
    }

    if (this.unsubscribeNativeState) {
      this.unsubscribeNativeState();
      this.unsubscribeNativeState = null;
    }

    const success = await this.nativeBridge.stopVoiceDetection();
    this.isListening = false;
    this.updateState(VoiceDetectionState.DISABLED);
    return success;
  }

  /**
   * Internal handler called when emergency voice keyword is detected.
   * Enforces mandatory 5-second trigger layer cooldown & ARM independence.
   */
  public async handleVoiceKeywordDetected(
    payload: VoiceTriggerPayload,
    userId: string = getEventOwner().userId,
    deviceId: string = getEventOwner().deviceId
  ): Promise<EmergencyEvent | null> {
    const now = Date.now();

    // 1. Mandatory 5-second Cooldown Check (Owned by SheGuard trigger layer)
    if (now - this.lastTriggerTime < VoiceActivationAdapter.COOLDOWN_MS) {
      return null;
    }

    this.lastTriggerTime = now;
    this.updateState(VoiceDetectionState.TRIGGER_REQUESTED);

    // Notify payload listeners
    this.payloadListeners.forEach((listener) => listener(payload));

    // 2. ARM-INDEPENDENT Emergency Trigger Execution
    // Directly triggers SOS via EmergencyCoordinator authority without checking ActivationManager state
    const emergencyEvent = await this.emergencyCoordinator.triggerEmergency(
      userId,
      deviceId,
      EmergencyTriggerSource.VOICE
    );

    this.updateState(VoiceDetectionState.COOLDOWN);

    // Schedule return to LISTENING after cooldown window
    setTimeout(() => {
      if (this.isListening) {
        this.updateState(VoiceDetectionState.LISTENING);
      }
    }, VoiceActivationAdapter.COOLDOWN_MS);

    return emergencyEvent;
  }

  public simulateVoiceTrigger(
    customPayload?: Partial<VoiceTriggerPayload>,
    userId?: string,
    deviceId?: string
  ): Promise<EmergencyEvent | null> {
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

    return this.handleVoiceKeywordDetected(payload, userId, deviceId);
  }
}
