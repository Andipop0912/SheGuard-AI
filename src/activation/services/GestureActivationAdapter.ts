import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { ActivationSourceAdapter } from '../domain/ActivationSourceAdapter';
import { ActivationRequest } from '../domain/ActivationRequest';
import { ActivationSource } from '../domain/ActivationSource';
import { ActivationState } from '../domain/ActivationState';
import { ActivationManager } from '../domain/ActivationManager';
import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { getEventOwner } from '../../app/identity';

const { SheGuardGestureModule } = NativeModules;

/**
 * Adapter bridging native Android ShakeDetector events to SheGuard activation & emergency lifecycle.
 *
 * Single Authoritative Shake Detector:
 * Native Android com.sheguardai.app.activation.ShakeDetector (SensorManager Accelerometer @ ~25Hz).
 *
 * This TypeScript layer consumes native GESTURE_TRIGGER_DETECTED events, validates ARM state
 * via ActivationManager (ARM dependent rule), and dispatches to EmergencyCoordinator.
 */
export class GestureActivationAdapter implements ActivationSourceAdapter {
  private listeners: Set<(request: ActivationRequest) => void> = new Set();
  private eventEmitter: NativeEventEmitter | null = null;
  private isListening = false;
  private subscription: any = null;

  private getActivationManager?: () => ActivationManager;
  private getEmergencyCoordinator?: () => EmergencyCoordinator;

  constructor(
    getActivationManager?: () => ActivationManager,
    getEmergencyCoordinator?: () => EmergencyCoordinator
  ) {
    this.getActivationManager = getActivationManager;
    this.getEmergencyCoordinator = getEmergencyCoordinator;

    if (Platform.OS === 'android' && SheGuardGestureModule) {
      this.eventEmitter = new NativeEventEmitter(SheGuardGestureModule);
    }
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public startListening(): void {
    if (this.isListening) return;
    this.isListening = true;

    if (Platform.OS === 'android' && SheGuardGestureModule) {
      SheGuardGestureModule.startGestureDetection().catch(() => {});

      if (this.eventEmitter && !this.subscription) {
        this.subscription = this.eventEmitter.addListener('GESTURE_TRIGGER_DETECTED', () => {
          this.handleGestureDetected();
        });
      }
    }
  }

  public stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;

    if (Platform.OS === 'android' && SheGuardGestureModule) {
      SheGuardGestureModule.stopGestureDetection().catch(() => {});
    }

    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
  }

  public observeRequests(listener: (request: ActivationRequest) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Called when a valid shake gesture is received from native ShakeDetector.kt.
   * Validates ARM status via ActivationManager before triggering emergency.
   */
  public async handleGestureDetected(timestamp: number = Date.now()): Promise<boolean> {
    const manager = this.getActivationManager?.();
    // Fail closed: without an ActivationManager, ARM cannot be confirmed, so shake is rejected.
    const currentState = manager ? manager.getActivationState() : ActivationState.INACTIVE;

    // ARM GATING RULE: GESTURE triggers require ActivationState.ACTIVE
    if (currentState !== ActivationState.ACTIVE) {
      console.warn('[GestureActivationAdapter] Shake event received while disarmed (State != ACTIVE). Trigger rejected.');
      return false;
    }

    const request: ActivationRequest = {
      requestId: `req-gesture-${Date.now()}`,
      source: ActivationSource.PHONE_GESTURE,
      requestedAt: timestamp,
      userInitiated: true,
    };

    // Notify request listeners
    this.listeners.forEach((listener) => listener(request));

    // Trigger emergency via EmergencyCoordinator
    const coordinator = this.getEmergencyCoordinator?.();
    if (coordinator) {
      const owner = getEventOwner();
      await coordinator.triggerEmergency(owner.userId, owner.deviceId, EmergencyTriggerSource.GESTURE);
    }

    return true;
  }

  /**
   * Helper to simulate a shake event for unit testing / debug UI.
   */
  public simulateShakeTrigger(): Promise<boolean> {
    return this.handleGestureDetected();
  }
}
