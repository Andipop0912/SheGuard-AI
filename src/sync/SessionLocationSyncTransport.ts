import { EmergencyLocationPoint } from '../location/storage/EmergencyLocationRepository';
import { LocationSyncResult, LocationSyncTransport } from '../location/sync/LocationSyncTransport';
import { SyncStatus } from '../emergency/domain/SyncStatus';
import { EmergencyStorageRepository } from '../storage/EmergencyStorageRepository';

const LOCAL_ONLY_MESSAGE = 'Emergency is kept on this phone only';
const EVENT_REJECTED_MESSAGE = 'Emergency was rejected by the server';

/**
 * Wraps the existing HTTP location transport so points are only sent for emergencies the server
 * has confirmed. Pending emergencies report EVENT_NOT_SYNCED without a network call; emergencies
 * that will never be uploaded (local-only, server-rejected) get their points marked rejected so
 * they are not retried forever.
 */
export class SessionLocationSyncTransport implements LocationSyncTransport {
  constructor(
    private readonly events: EmergencyStorageRepository,
    private readonly http: LocationSyncTransport
  ) {}

  public async send(eventId: string, points: EmergencyLocationPoint[]): Promise<LocationSyncResult> {
    const event = await this.events.getEvent(eventId);
    if (!event) return this.rejectAll(points, 'Emergency not found on this phone');

    switch (event.syncStatus) {
      case SyncStatus.SYNCED:
        return this.http.send(eventId, points);
      case SyncStatus.PENDING:
        return { kind: 'EVENT_NOT_SYNCED' };
      case SyncStatus.LOCAL_ONLY:
        return this.rejectAll(points, LOCAL_ONLY_MESSAGE);
      case SyncStatus.FAILED:
      default:
        return this.rejectAll(points, EVENT_REJECTED_MESSAGE);
    }
  }

  private rejectAll(points: EmergencyLocationPoint[], message: string): LocationSyncResult {
    return {
      kind: 'RESULTS',
      results: points.map((p) => ({ locationId: p.locationId, status: 'FAILED' as const, message })),
    };
  }
}
