import { create } from 'zustand';
import { EmergencyEvent } from '../domain/EmergencyEvent';
import { EmergencyTriggerSource } from '../domain/EmergencyTriggerSource';
import { AppContainer } from '../../app/di/AppContainer';
import { getEventOwner } from '../../app/identity';

interface EmergencyStoreState {
  currentEvent: EmergencyEvent | null;
  allEvents: EmergencyEvent[];
  /** True from the SOS press until the coordinator returns the event (UI feedback only). */
  isTriggering: boolean;

  /**
   * Subscribes to EmergencyCoordinator (the only writer of emergency state) and
   * restores an unfinished event after an app restart. Idempotent.
   */
  initialize: () => Promise<void>;
  /**
   * Manual SOS: immediate, local-first, ARM independent. Goes through EmergencyCoordinator,
   * whose single-open invariant returns the already-open emergency instead of a duplicate.
   */
  triggerManualSos: () => Promise<EmergencyEvent>;
  triggerEmergency: (userId: string, deviceId: string, source: EmergencyTriggerSource) => Promise<EmergencyEvent>;
  resolveEmergency: (eventId: string) => Promise<void>;
  cancelEmergency: (eventId: string) => Promise<void>;
  /** Asks the sync service to upload pending events now (developer diagnostics). */
  syncNow: () => Promise<void>;
  loadAllEvents: () => Promise<void>;
}

let unsubscribeActiveEvent: (() => void) | null = null;

export const useEmergencyStore = create<EmergencyStoreState>((set, get) => ({
  currentEvent: null,
  allEvents: [],
  isTriggering: false,

  initialize: async () => {
    if (unsubscribeActiveEvent) return;

    const coordinator = AppContainer.getInstance().emergencyCoordinator;

    // Receives every lifecycle change, whatever the trigger: manual, voice, gesture or hardware.
    unsubscribeActiveEvent = coordinator.subscribeActiveEvent((event) => {
      set({ currentEvent: event });
      if (event) {
        get().loadAllEvents();
      }
    });

    await coordinator.restoreActiveEvent();
    await get().loadAllEvents();
  },

  triggerManualSos: async () => {
    set({ isTriggering: true });
    try {
      const owner = getEventOwner();
      return await get().triggerEmergency(owner.userId, owner.deviceId, EmergencyTriggerSource.MANUAL_SOS);
    } finally {
      set({ isTriggering: false });
    }
  },

  triggerEmergency: async (userId: string, deviceId: string, source: EmergencyTriggerSource) => {
    const container = AppContainer.getInstance();
    const event = await container.emergencyCoordinator.triggerEmergency(userId, deviceId, source);
    set({ currentEvent: event });
    await get().loadAllEvents();
    return event;
  },

  resolveEmergency: async (eventId: string) => {
    const container = AppContainer.getInstance();
    const updated = await container.emergencyCoordinator.resolveEmergency(eventId);
    if (updated) {
      set({ currentEvent: updated });
    }
    await get().loadAllEvents();
  },

  cancelEmergency: async (eventId: string) => {
    const container = AppContainer.getInstance();
    const updated = await container.emergencyCoordinator.cancelEmergency(eventId);
    if (updated) {
      set({ currentEvent: updated });
    }
    await get().loadAllEvents();
  },

  syncNow: async () => {
    await AppContainer.getInstance().emergencySyncService.flush();
    await get().loadAllEvents();
  },

  loadAllEvents: async () => {
    const container = AppContainer.getInstance();
    const events = await container.emergencyRepository.getAllEvents();
    set({ allEvents: events });
  },
}));

/** Releases the coordinator subscription. Tests only. */
export function teardownEmergencyStoreForTesting(): void {
  unsubscribeActiveEvent?.();
  unsubscribeActiveEvent = null;
}
