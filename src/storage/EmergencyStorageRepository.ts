declare const require: any;

import { EmergencyEvent } from '../emergency/domain/EmergencyEvent';
import { SyncStatus } from '../emergency/domain/SyncStatus';

let AsyncStorage: any = null;
try {
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  // ESM build exposes `.default`; the CommonJS Jest mock is the module object itself.
  AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
} catch {
  AsyncStorage = null;
}

const EMERGENCY_EVENTS_KEY = '@sheguard_emergency_events_v1';
/**
 * One-time marker (Phase 3C). Events stored before real server sync existed were never uploaded
 * (their SYNCED status came from a simulated sync), so they are marked LOCAL_ONLY, not re-uploaded.
 */
const SYNC_MIGRATION_KEY = '@sheguard_emergency_sync_migration_v1';
export const LEGACY_LOCAL_ONLY_REASON = 'Recorded before server backup existed';

/** Sync bookkeeping the sync service may change. Lifecycle fields (state, timestamps) are never touched. */
export type SyncOutcomePatch = Partial<
  Pick<EmergencyEvent, 'syncStatus' | 'syncedAt' | 'syncError' | 'userId' | 'deviceId'>
>;

export class EmergencyStorageRepository {
  private inMemoryCache: Map<string, EmergencyEvent> = new Map();
  private isStorageAvailable = true;
  // Every read/write waits for the initial load so an early save cannot
  // overwrite persisted history with a cache that has not been hydrated yet.
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadEventsFromStorage();
  }

  private async loadEventsFromStorage(): Promise<void> {
    if (!AsyncStorage) return;
    try {
      const jsonValue = await AsyncStorage.getItem(EMERGENCY_EVENTS_KEY);
      if (jsonValue != null) {
        const events: EmergencyEvent[] = JSON.parse(jsonValue);
        events.forEach((event) => {
          this.inMemoryCache.set(event.eventId, event);
        });
      }
    } catch {
      this.isStorageAvailable = false;
      return;
    }
    await this.migrateLegacySyncStatus();
  }

  private async migrateLegacySyncStatus(): Promise<void> {
    try {
      if ((await AsyncStorage.getItem(SYNC_MIGRATION_KEY)) != null) return;
      if (this.inMemoryCache.size > 0) {
        this.inMemoryCache.forEach((event, id) => {
          this.inMemoryCache.set(id, {
            ...event,
            syncStatus: SyncStatus.LOCAL_ONLY,
            syncedAt: null,
            syncError: LEGACY_LOCAL_ONLY_REASON,
          });
        });
        await this.persistToStorage();
      }
      await AsyncStorage.setItem(SYNC_MIGRATION_KEY, '1');
    } catch {
      // Retried on next launch; until then events keep their stored status.
    }
  }

  private async persistToStorage(): Promise<void> {
    if (!this.isStorageAvailable || !AsyncStorage) return;
    try {
      const events = Array.from(this.inMemoryCache.values());
      await AsyncStorage.setItem(EMERGENCY_EVENTS_KEY, JSON.stringify(events));
    } catch {
      // Memory fallback active if storage fails
    }
  }

  public async saveEvent(event: EmergencyEvent): Promise<EmergencyEvent> {
    await this.ready;
    this.inMemoryCache.set(event.eventId, event);
    await this.persistToStorage();
    return event;
  }

  public async getEvent(eventId: string): Promise<EmergencyEvent | null> {
    await this.ready;
    return this.inMemoryCache.get(eventId) ?? null;
  }

  public async getAllEvents(): Promise<EmergencyEvent[]> {
    await this.ready;
    return Array.from(this.inMemoryCache.values());
  }

  /** Events waiting for upload, oldest first. FAILED (server-rejected) and LOCAL_ONLY are excluded. */
  public async getPendingSyncEvents(): Promise<EmergencyEvent[]> {
    await this.ready;
    return Array.from(this.inMemoryCache.values())
      .filter((e) => e.syncStatus === SyncStatus.PENDING)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Records a sync result for the version that was sent. Compare-and-set: applied only if the
   * stored event still has `expectedUpdatedAt`; if the event changed meanwhile (e.g. resolved
   * during the upload) it stays PENDING so the newer version is uploaded next.
   * Never changes lifecycle fields: `updatedAt` stays the event's own lifecycle timestamp.
   */
  public async applySyncOutcome(
    eventId: string,
    expectedUpdatedAt: number,
    patch: SyncOutcomePatch
  ): Promise<EmergencyEvent | null> {
    await this.ready;
    const event = this.inMemoryCache.get(eventId);
    if (!event || event.updatedAt !== expectedUpdatedAt) return null;

    const updatedEvent: EmergencyEvent = { ...event, ...patch };
    this.inMemoryCache.set(eventId, updatedEvent);
    await this.persistToStorage();
    return updatedEvent;
  }

  public async clearAll(): Promise<void> {
    await this.ready;
    this.inMemoryCache.clear();
    if (!AsyncStorage) return;
    try {
      await AsyncStorage.removeItem(EMERGENCY_EVENTS_KEY);
    } catch {
      // ignore
    }
  }
}
