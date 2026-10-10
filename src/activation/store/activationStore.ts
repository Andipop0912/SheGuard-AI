import { create } from 'zustand';
import { ActivationState } from '../domain/ActivationState';
import { ActivationResult } from '../domain/ActivationResult';
import { ActivationSource } from '../domain/ActivationSource';
import { AppContainer } from '../../app/di/AppContainer';

interface ActivationStoreState {
  activationState: ActivationState;
  activeSessionId: string | null;
  lastResult: ActivationResult | null;
  /** Whether the native shake detector is running (only while ARM / protection is ACTIVE). */
  isShakeListening: boolean;
  /** When protection most recently became ACTIVE (null while not active). */
  armedAt: number | null;

  /** Protection Mode ON: user-initiated request through ActivationManager. */
  arm: () => Promise<ActivationResult>;
  /** Protection Mode OFF through ActivationManager. */
  disarm: () => Promise<void>;

  startActivationSource: () => void;
  stopActivationSource: () => void;
  stopProtection: () => Promise<void>;
  resetToInactive: () => void;
}

let unsubscribeState: (() => void) | null = null;
let unsubscribeSession: (() => void) | null = null;
let unsubscribeRequests: (() => void) | null = null;

export const useActivationStore = create<ActivationStoreState>((set, get) => ({
  activationState: ActivationState.INACTIVE,
  activeSessionId: null,
  lastResult: null,
  isShakeListening: false,
  armedAt: null,

  startActivationSource: () => {
    const container = AppContainer.getInstance();
    const manager = container.activationManager;
    const source = container.mockActivationSource;
    const shake = container.gestureActivationSource;

    // Cleanup previous subscriptions
    if (unsubscribeState) unsubscribeState();
    if (unsubscribeSession) unsubscribeSession();
    if (unsubscribeRequests) unsubscribeRequests();

    unsubscribeState = manager.subscribeState((state) => {
      // Shake is ARM dependent: the native accelerometer listener runs only while ACTIVE.
      // GestureActivationAdapter additionally re-checks ARM for every shake event.
      if (state === ActivationState.ACTIVE) {
        shake.startListening();
      } else {
        shake.stopListening();
      }
      const wasActive = get().activationState === ActivationState.ACTIVE;
      const isActive = state === ActivationState.ACTIVE;
      set({
        activationState: state,
        isShakeListening: shake.getIsListening(),
        armedAt: isActive ? (wasActive ? get().armedAt : Date.now()) : null,
      });
    });

    unsubscribeSession = manager.subscribeSession((sessionId) => {
      set({ activeSessionId: sessionId });
    });

    source.startListening();

    unsubscribeRequests = source.observeRequests(async (request) => {
      const result = await manager.handleActivation(request);
      set({ lastResult: result });
    });
  },

  stopActivationSource: () => {
    const container = AppContainer.getInstance();
    container.mockActivationSource.stopListening();
    if (unsubscribeRequests) {
      unsubscribeRequests();
      unsubscribeRequests = null;
    }
  },

  arm: async () => {
    const manager = AppContainer.getInstance().activationManager;
    const result = await manager.handleActivation({
      requestId: `req-in-app-${Date.now()}`,
      source: ActivationSource.IN_APP,
      requestedAt: Date.now(),
      userInitiated: true,
    });
    set({ lastResult: result });
    return result;
  },

  disarm: async () => {
    const manager = AppContainer.getInstance().activationManager;
    if (manager.getActivationState() === ActivationState.ACTIVE) {
      await get().stopProtection();
    } else {
      get().resetToInactive();
    }
  },

  stopProtection: async () => {
    const container = AppContainer.getInstance();
    const result = await container.activationManager.stopProtection();
    if (!result.success) {
      set({
        lastResult: {
          type: 'Failed',
          code: 'STOP_FAILED',
          message: result.error?.message ?? 'Unable to stop protection.',
        },
      });
    }
  },

  resetToInactive: () => {
    const container = AppContainer.getInstance();
    container.activationManager.resetToInactive();
    set({
      activationState: ActivationState.INACTIVE,
      activeSessionId: null,
      lastResult: null,
    });
  },
}));

/** Releases store subscriptions and stops shake detection. Tests only. */
export function teardownActivationStoreForTesting(): void {
  unsubscribeState?.();
  unsubscribeSession?.();
  unsubscribeRequests?.();
  unsubscribeState = null;
  unsubscribeSession = null;
  unsubscribeRequests = null;
  AppContainer.getInstance().gestureActivationSource.stopListening();
}
