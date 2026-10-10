import { AppState } from 'react-native';
import { create } from 'zustand';
import { AppContainer } from '../../app/di/AppContainer';
import { LocationFix } from '../domain/LocationFix';
import {
  EmergencyLocationState,
  INITIAL_LOCATION_READINESS,
  LocationReadiness,
  LocationTrackingState,
} from '../domain/LocationState';
import { LocationSyncState } from '../sync/LocationSyncQueue';

interface LocationStoreState {
  readiness: LocationReadiness;
  emergencyLocation: EmergencyLocationState | null;
  tracking: LocationTrackingState;
  sync: LocationSyncState;
  /** Best-effort reverse-geocoded address for `addressFor`. Presentation only; coordinates are authoritative. */
  address: string | null;
  addressFor: LocationFix | null;

  /** Subscribes to the location layer and starts the emergency location controller. Idempotent. */
  initialize: () => Promise<void>;
  requestPermission: () => Promise<void>;
  refreshCurrentLocation: () => Promise<void>;
  lookupAddress: (fix: LocationFix) => Promise<void>;
}

let unsubscribers: (() => void)[] = [];

export const useLocationStore = create<LocationStoreState>((set, get) => ({
  readiness: INITIAL_LOCATION_READINESS,
  emergencyLocation: null,
  tracking: LocationTrackingState.IDLE,
  sync: { kind: 'IDLE', pending: 0 },
  address: null,
  addressFor: null,

  initialize: async () => {
    if (unsubscribers.length > 0) return;
    const container = AppContainer.getInstance();

    unsubscribers = [
      container.locationService.subscribeReadiness((readiness) => set({ readiness })),
      container.locationService.subscribeTracking((tracking) => set({ tracking })),
      container.emergencyLocationController.subscribe((emergencyLocation) => set({ emergencyLocation })),
      container.locationSyncQueue.subscribe((sync) => set({ sync })),
    ];
    // Permission / location-services changes made in Android Settings produce no JS event;
    // re-read them whenever the app returns to the foreground (no polling).
    const appStateSubscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        container.locationService.refreshReadiness().catch(() => {});
      }
    });
    unsubscribers.push(() => appStateSubscription.remove());
    container.emergencyLocationController.start();

    await container.locationService.refreshReadiness();
    await container.locationSyncQueue.flush();
  },

  requestPermission: async () => {
    await AppContainer.getInstance().locationService.requestPermission();
  },

  refreshCurrentLocation: async () => {
    await AppContainer.getInstance().locationService.acquireCurrentFix();
  },

  lookupAddress: async (fix: LocationFix) => {
    const address = await AppContainer.getInstance().locationService.reverseGeocode(fix);
    // Only show an address for the fix it was resolved from.
    if (get().readiness.fix === fix || get().emergencyLocation?.latestFix === fix) {
      set({ address, addressFor: fix });
    }
  },
}));

/** Releases store subscriptions. Tests only. */
export function teardownLocationStoreForTesting(): void {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}
