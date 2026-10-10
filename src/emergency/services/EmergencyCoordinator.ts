import { EmergencyEvent, createEmergencyEvent } from '../domain/EmergencyEvent';
import { EmergencyState, isOpenEmergencyState } from '../domain/EmergencyState';
import { EmergencyTriggerSource } from '../domain/EmergencyTriggerSource';
import { SyncStatus } from '../domain/SyncStatus';
import { EmergencyStorageRepository } from '../../storage/EmergencyStorageRepository';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** A trigger that arrived while an emergency was already open (no new event was created). */
export interface AdditionalTrigger {
  readonly eventId: string;
  readonly triggerSource: EmergencyTriggerSource;
  readonly receivedAt: number;
}

const MAX_ADDITIONAL_TRIGGERS = 50;

/**
 * Version timestamp for a lifecycle change. `updatedAt` is the event's version for sync
 * (client compare-and-set and the backend's ordering), so every change of the same event must get
 * a strictly greater value, even when two changes fall in the same clock tick.
 */
function nextUpdatedAt(previous: number, now: number = Date.now()): number {
  return Math.max(now, previous + 1);
}

/** A lifecycle change needs uploading again, except for events that are local-only by design. */
function pendingSyncStatusAfterChange(existing: EmergencyEvent): SyncStatus {
  return existing.syncStatus === SyncStatus.LOCAL_ONLY ? SyncStatus.LOCAL_ONLY : SyncStatus.PENDING;
}

export class EmergencyCoordinator {
  private repository: EmergencyStorageRepository;
  private currentActiveEvent: EmergencyEvent | null = null;
  private triggerInFlight: Promise<EmergencyEvent> | null = null;
  private additionalTriggers: AdditionalTrigger[] = [];
  private listeners: Set<(event: EmergencyEvent | null) => void> = new Set();

  constructor(repository: EmergencyStorageRepository) {
    this.repository = repository;
  }

  public getCurrentActiveEvent(): EmergencyEvent | null {
    return this.currentActiveEvent;
  }

  public subscribeActiveEvent(listener: (event: EmergencyEvent | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentActiveEvent);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Re-attaches the most recent unfinished persisted event as the active one,
   * so an emergency survives an app restart. Returns the restored event, if any.
   */
  public async restoreActiveEvent(): Promise<EmergencyEvent | null> {
    const open = this.getOpenActiveEvent();
    if (open) return open;

    const latestOpen = await this.findLatestPersistedOpenEvent();

    if (!latestOpen) return null;

    this.currentActiveEvent = latestOpen;
    this.notifyListeners();
    return latestOpen;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.currentActiveEvent));
  }

  /**
   * Single entry point for every trigger source (manual, voice, gesture, hardware).
   *
   * Invariant: at most ONE open emergency at a time. While an emergency is open,
   * further triggers return that same event and are only recorded as additional
   * triggers; they never create a second EmergencyEvent.
   *
   * Race safety: this method is deliberately not `async`. The open-event check and
   * the in-flight lock are taken synchronously, before any await, so near-simultaneous
   * calls (JS runs them on one thread) cannot both pass the check and both create.
   */
  public triggerEmergency(
    userId: string,
    deviceId: string,
    triggerSource: EmergencyTriggerSource
  ): Promise<EmergencyEvent> {
    const open = this.getOpenActiveEvent();
    if (open) {
      this.recordAdditionalTrigger(open.eventId, triggerSource);
      return this.latestVersionOf(open);
    }

    // A creation is already in progress: converge on the event it produces.
    if (this.triggerInFlight) {
      return this.triggerInFlight.then((event) => {
        this.recordAdditionalTrigger(event.eventId, triggerSource);
        return event;
      });
    }

    const pending = this.openOrCreateEmergency(userId, deviceId, triggerSource);
    this.triggerInFlight = pending;
    const releaseLock = () => {
      if (this.triggerInFlight === pending) {
        this.triggerInFlight = null;
      }
    };
    pending.then(releaseLock, releaseLock);
    return pending;
  }

  /** Additional triggers received while an emergency was already open (most recent last). */
  public getAdditionalTriggers(eventId?: string): readonly AdditionalTrigger[] {
    return eventId
      ? this.additionalTriggers.filter((t) => t.eventId === eventId)
      : this.additionalTriggers;
  }

  private getOpenActiveEvent(): EmergencyEvent | null {
    const current = this.currentActiveEvent;
    return current && isOpenEmergencyState(current.state) ? current : null;
  }

  private async latestVersionOf(event: EmergencyEvent): Promise<EmergencyEvent> {
    return (await this.repository.getEvent(event.eventId)) ?? event;
  }

  private recordAdditionalTrigger(eventId: string, triggerSource: EmergencyTriggerSource): void {
    this.additionalTriggers.push({ eventId, triggerSource, receivedAt: Date.now() });
    if (this.additionalTriggers.length > MAX_ADDITIONAL_TRIGGERS) {
      this.additionalTriggers.shift();
    }
    console.info(
      `[EmergencyCoordinator] ${triggerSource} trigger joined open emergency ${eventId}; no new event created.`
    );
  }

  private async findLatestPersistedOpenEvent(): Promise<EmergencyEvent | null> {
    const events = await this.repository.getAllEvents();
    return (
      events
        .filter((e) => isOpenEmergencyState(e.state))
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  }

  /** Runs under the in-flight lock taken by triggerEmergency(). */
  private async openOrCreateEmergency(
    userId: string,
    deviceId: string,
    triggerSource: EmergencyTriggerSource
  ): Promise<EmergencyEvent> {
    // An open emergency may exist only in storage (e.g. a trigger right after an app
    // restart, before restoreActiveEvent() ran). It still counts as the open emergency.
    const persistedOpen = await this.findLatestPersistedOpenEvent();
    if (persistedOpen) {
      this.currentActiveEvent = persistedOpen;
      this.notifyListeners();
      this.recordAdditionalTrigger(persistedOpen.eventId, triggerSource);
      return persistedOpen;
    }

    const eventId = `evt-${generateUUID()}`;

    // 1. Create event locally with PENDING status
    let event = createEmergencyEvent({
      eventId,
      userId,
      deviceId,
      triggerSource,
      state: EmergencyState.TRIGGERED,
      syncStatus: SyncStatus.PENDING,
    });

    await this.repository.saveEvent(event);

    // 2. Transition state to RESPONDING/MONITORING
    event = {
      ...event,
      state: EmergencyState.RESPONDING,
      updatedAt: nextUpdatedAt(event.updatedAt),
    };
    await this.repository.saveEvent(event);

    this.currentActiveEvent = event;
    this.notifyListeners();

    // Backend sync is NOT part of this path. EmergencySyncService observes the coordinator
    // and uploads PENDING events asynchronously; network, auth or server state can never
    // delay or prevent creating the emergency.
    return event;
  }

  public async resolveEmergency(eventId: string): Promise<EmergencyEvent | null> {
    const existing = await this.repository.getEvent(eventId);
    if (!existing) return null;

    const resolvedNow = Date.now();
    const resolved: EmergencyEvent = {
      ...existing,
      state: EmergencyState.RESOLVED,
      resolvedAt: resolvedNow,
      updatedAt: nextUpdatedAt(existing.updatedAt, resolvedNow),
      syncStatus: pendingSyncStatusAfterChange(existing),
    };

    await this.repository.saveEvent(resolved);

    if (this.currentActiveEvent?.eventId === eventId) {
      this.currentActiveEvent = resolved;
      this.notifyListeners();
    }

    return resolved;
  }

  public async cancelEmergency(eventId: string): Promise<EmergencyEvent | null> {
    const existing = await this.repository.getEvent(eventId);
    if (!existing) return null;

    const cancelledNow = Date.now();
    const cancelled: EmergencyEvent = {
      ...existing,
      state: EmergencyState.CANCELLED,
      resolvedAt: cancelledNow,
      updatedAt: nextUpdatedAt(existing.updatedAt, cancelledNow),
      syncStatus: pendingSyncStatusAfterChange(existing),
    };

    await this.repository.saveEvent(cancelled);

    if (this.currentActiveEvent?.eventId === eventId) {
      this.currentActiveEvent = cancelled;
      this.notifyListeners();
    }

    return cancelled;
  }
}
