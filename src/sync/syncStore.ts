import { create } from 'zustand';
import { EmergencySyncSnapshot } from './EmergencySyncService';

/** Mirror of EmergencySyncService's snapshot for the UI (filled by startServerSync). */
export const useSyncStore = create<EmergencySyncSnapshot>(() => ({
  activity: { kind: 'IDLE' },
  syncingEventIds: [],
  revision: 0,
}));
