import { create } from 'zustand';
import { AppContainer } from '../../app/di/AppContainer';
import { CommunicationStatusSnapshot } from '../services/CommunicationStatusService';

interface CommunicationStoreState {
  byEvent: Record<string, CommunicationStatusSnapshot>;
  /** Start reading alert status for an emergency; returns the stop function. */
  watch: (eventId: string) => () => void;
}

export const useCommunicationStore = create<CommunicationStoreState>((set) => ({
  byEvent: {},
  watch: (eventId) =>
    AppContainer.getInstance().communicationStatusService.watch(eventId, (snapshot) =>
      set((state) => ({ byEvent: { ...state.byEvent, [snapshot.eventId]: snapshot } }))
    ),
}));
