import { create } from 'zustand';
import { AppContainer } from '../../app/di/AppContainer';
import { RouteRequest, RouteSafetyController } from '../services/RouteSafetyController';
import { RouteSafetySession, RouteSafetyStatus } from '../domain/RouteSafetySession';

interface RouteSafetyStoreState {
  session: RouteSafetySession | null;
  starting: boolean;
  error: string | null;

  /** Restores a session left ACTIVE from a previous run, and subscribes. Idempotent. */
  initialize: () => Promise<void>;
  start: (request: RouteRequest) => Promise<boolean>;
  end: () => Promise<void>;
  cancel: () => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

function controller(): RouteSafetyController {
  return AppContainer.getInstance().routeSafetyController;
}

export const useRouteSafetyStore = create<RouteSafetyStoreState>((set) => ({
  session: null,
  starting: false,
  error: null,

  initialize: async () => {
    if (!unsubscribe) {
      unsubscribe = controller().subscribe((session) => set({ session }));
    }
    await controller().restore();
  },

  start: async (request: RouteRequest) => {
    set({ starting: true, error: null });
    try {
      await controller().start(request);
      set({ starting: false });
      return true;
    } catch (e) {
      set({ starting: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  end: async () => {
    await controller().end(RouteSafetyStatus.ENDED);
  },

  cancel: async () => {
    await controller().end(RouteSafetyStatus.CANCELLED);
  },
}));
