import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationFix } from '../domain/LocationFix';
import { EmergencyLocationStatus, LocationUnavailableReason } from '../domain/LocationState';

export enum LocationPointKind {
  SNAPSHOT = 'SNAPSHOT',
  UPDATE = 'UPDATE',
}

export enum LocationSyncStatus {
  PENDING = 'PENDING',
  SYNCED = 'SYNCED',
  /** Rejected by the server for a non-retryable reason; kept locally regardless. */
  REJECTED = 'REJECTED',
}

export interface EmergencyLocationPoint {
  readonly locationId: string;
  readonly eventId: string;
  readonly kind: LocationPointKind;
  readonly fix: LocationFix;
  readonly recordedAt: number;
  readonly syncStatus: LocationSyncStatus;
  readonly syncAttempts: number;
  readonly lastSyncError: string | null;
}

export interface EmergencyLocationSummary {
  readonly eventId: string;
  readonly status: EmergencyLocationStatus;
  readonly reason: LocationUnavailableReason | null;
  readonly updatedAt: number;
}

interface PersistedShape {
  points: EmergencyLocationPoint[];
  summaries: EmergencyLocationSummary[];
}

const STORAGE_KEY = '@sheguard_emergency_locations_v1';

function generateLocationId(): string {
  return 'loc-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Device-side source of truth for emergency locations. Offline-first: points are kept
 * regardless of network or backend state, and sync outcomes only ever change their status.
 */
export class EmergencyLocationRepository {
  private points = new Map<string, EmergencyLocationPoint>();
  private summaries = new Map<string, EmergencyLocationSummary>();
  private readonly ready: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly maxPointsPerEmergency: number,
    private readonly now: () => number = Date.now
  ) {
    this.ready = this.load();
  }

  public async addPoint(eventId: string, kind: LocationPointKind, fix: LocationFix): Promise<EmergencyLocationPoint | null> {
    await this.ready;
    if (this.countForEvent(eventId) >= this.maxPointsPerEmergency) {
      return null;
    }
    const point: EmergencyLocationPoint = {
      locationId: generateLocationId(),
      eventId,
      kind,
      fix,
      recordedAt: this.now(),
      syncStatus: LocationSyncStatus.PENDING,
      syncAttempts: 0,
      lastSyncError: null,
    };
    this.points.set(point.locationId, point);
    await this.persist();
    return point;
  }

  public async getPoints(eventId: string): Promise<EmergencyLocationPoint[]> {
    await this.ready;
    return this.pointsForEvent(eventId);
  }

  public async getLatestPoint(eventId: string): Promise<EmergencyLocationPoint | null> {
    await this.ready;
    const points = this.pointsForEvent(eventId);
    return points.length > 0 ? points[points.length - 1] : null;
  }

  public async getPendingPoints(limit: number): Promise<EmergencyLocationPoint[]> {
    await this.ready;
    return Array.from(this.points.values())
      .filter((p) => p.syncStatus === LocationSyncStatus.PENDING)
      .sort((a, b) => a.fix.timestamp - b.fix.timestamp)
      .slice(0, limit);
  }

  public async countPending(): Promise<number> {
    await this.ready;
    return Array.from(this.points.values()).filter((p) => p.syncStatus === LocationSyncStatus.PENDING).length;
  }

  public async markSynced(locationIds: string[]): Promise<void> {
    await this.updatePoints(locationIds, (p) => ({ ...p, syncStatus: LocationSyncStatus.SYNCED, lastSyncError: null }));
  }

  public async markRejected(locationIds: string[], error: string): Promise<void> {
    await this.updatePoints(locationIds, (p) => ({
      ...p,
      syncStatus: LocationSyncStatus.REJECTED,
      syncAttempts: p.syncAttempts + 1,
      lastSyncError: error,
    }));
  }

  /** Records a retryable failure: the point stays PENDING. */
  public async markAttemptFailed(locationIds: string[], error: string): Promise<void> {
    await this.updatePoints(locationIds, (p) => ({ ...p, syncAttempts: p.syncAttempts + 1, lastSyncError: error }));
  }

  public async setSummary(
    eventId: string,
    status: EmergencyLocationStatus,
    reason: LocationUnavailableReason | null
  ): Promise<EmergencyLocationSummary> {
    await this.ready;
    const summary: EmergencyLocationSummary = { eventId, status, reason, updatedAt: this.now() };
    this.summaries.set(eventId, summary);
    await this.persist();
    return summary;
  }

  public async getSummary(eventId: string): Promise<EmergencyLocationSummary | null> {
    await this.ready;
    return this.summaries.get(eventId) ?? null;
  }

  private countForEvent(eventId: string): number {
    let count = 0;
    this.points.forEach((p) => {
      if (p.eventId === eventId) count++;
    });
    return count;
  }

  private pointsForEvent(eventId: string): EmergencyLocationPoint[] {
    return Array.from(this.points.values())
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.fix.timestamp - b.fix.timestamp);
  }

  private async updatePoints(
    locationIds: string[],
    update: (point: EmergencyLocationPoint) => EmergencyLocationPoint
  ): Promise<void> {
    await this.ready;
    let changed = false;
    for (const id of locationIds) {
      const point = this.points.get(id);
      if (point) {
        this.points.set(id, update(point));
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async load(): Promise<void> {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      if (!json) return;
      const stored = JSON.parse(json) as Partial<PersistedShape>;
      (stored.points ?? []).forEach((p) => this.points.set(p.locationId, p));
      (stored.summaries ?? []).forEach((s) => this.summaries.set(s.eventId, s));
    } catch {
      // Corrupt or unavailable storage: continue with in-memory state.
    }
  }

  private persist(): Promise<void> {
    const snapshot: PersistedShape = {
      points: Array.from(this.points.values()),
      summaries: Array.from(this.summaries.values()),
    };
    this.writeChain = this.writeChain
      .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)))
      .catch(() => {
        // In-memory state stays authoritative if a write fails.
      });
    return this.writeChain;
  }
}
