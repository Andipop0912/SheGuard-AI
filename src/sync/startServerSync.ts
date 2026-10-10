import { AppState } from 'react-native';
import { AppContainer } from '../app/di/AppContainer';
import { API_TIMEOUT_MS, getApiBaseUrl } from '../api/apiConfig';
import { AuthState } from '../auth/domain/AuthState';
import { DisconnectedLocationSyncTransport, HttpLocationSyncTransport } from '../location/sync/LocationSyncTransport';
import { SessionLocationSyncTransport } from './SessionLocationSyncTransport';
import { DisconnectedEvidenceUploadTransport, HttpEvidenceUploadTransport } from '../evidence/sync/EvidenceUploadTransport';
import { useSyncStore } from './syncStore';
import { useEmergencyStore } from '../emergency/store/emergencyStore';
import { useContactsStore } from '../contacts/store/contactsStore';

let stop: (() => void) | null = null;

/**
 * Connects the already-running safety core to the server, after it has started:
 * - emergency uploads follow coordinator changes, sign-in and app foreground;
 * - location points use the HTTP transport only while signed in (and only for synced events).
 * Idempotent. Nothing here is on the emergency trigger path.
 */
export function startServerSync(container: AppContainer = AppContainer.getInstance()): () => void {
  if (stop) return stop;
  const { authService, emergencySyncService, locationSyncQueue, emergencyRepository, evidenceSyncQueue } = container;

  emergencySyncService.setAfterFlush(() => {
    locationSyncQueue.flush().catch(() => undefined);
  });
  const unsubscribeSync = emergencySyncService.subscribe((snapshot) => {
    const previous = useSyncStore.getState().revision;
    useSyncStore.setState(snapshot);
    if (snapshot.revision !== previous) {
      useEmergencyStore.getState().loadAllEvents().catch(() => undefined);
    }
  });
  emergencySyncService.start();

  let lastState: AuthState | null = null;
  const unsubscribeAuth = authService.subscribe((snapshot) => {
    if (snapshot.state === lastState) return;
    lastState = snapshot.state;
    if (snapshot.state === AuthState.AUTHENTICATED) {
      const baseUrl = getApiBaseUrl();
      const transport = baseUrl
        ? new SessionLocationSyncTransport(
            emergencyRepository,
            new HttpLocationSyncTransport(baseUrl, authService, API_TIMEOUT_MS)
          )
        : new DisconnectedLocationSyncTransport();
      locationSyncQueue.setTransport(transport).catch(() => undefined);
      evidenceSyncQueue
        .setTransport(baseUrl ? new HttpEvidenceUploadTransport(baseUrl, authService, API_TIMEOUT_MS) : new DisconnectedEvidenceUploadTransport())
        .catch(() => undefined);
      emergencySyncService.requestFlush();
    } else if (snapshot.state === AuthState.UNAUTHENTICATED) {
      locationSyncQueue.setTransport(new DisconnectedLocationSyncTransport()).catch(() => undefined);
      evidenceSyncQueue.setTransport(new DisconnectedEvidenceUploadTransport()).catch(() => undefined);
      emergencySyncService.onSignedOut();
      useContactsStore.getState().clear();
    }
  });

  const appStateSubscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') emergencySyncService.requestFlush();
  });

  stop = () => {
    unsubscribeAuth();
    unsubscribeSync();
    appStateSubscription.remove();
    emergencySyncService.dispose();
    stop = null;
  };
  return stop;
}

/** Tests only. */
export function stopServerSyncForTesting(): void {
  stop?.();
}
