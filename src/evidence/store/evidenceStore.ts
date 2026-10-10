import { create } from 'zustand';
import { AppContainer } from '../../app/di/AppContainer';
import { EvidenceItem } from '../domain/EvidenceItem';
import { EvidenceControllerState } from '../services/EvidenceController';

interface EvidenceStoreState {
  current: EvidenceControllerState | null;
  itemsByEvent: Record<string, EvidenceItem[]>;

  /** Subscribes to the evidence layer and starts the controller. Idempotent. */
  initialize: () => void;
  loadForEvent: (eventId: string) => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useEvidenceStore = create<EvidenceStoreState>((set, get) => ({
  current: null,
  itemsByEvent: {},

  initialize: () => {
    if (unsubscribe) return;
    const container = AppContainer.getInstance();

    unsubscribe = container.evidenceController.subscribe((current) => {
      set({ current });
      if (current?.status === 'SAVED') {
        get().loadForEvent(current.eventId);
      }
    });
    container.evidenceController.start();
    container.evidenceDeliveryController.start();
  },

  loadForEvent: async (eventId: string) => {
    const items = await AppContainer.getInstance().evidenceController.getItemsForEvent(eventId);
    set((state) => ({ itemsByEvent: { ...state.itemsByEvent, [eventId]: items } }));
  },
}));
