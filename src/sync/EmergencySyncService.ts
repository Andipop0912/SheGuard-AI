import { ApiClient } from '../api/ApiClient';
import { ApiError } from '../api/HttpClient';
import {
  EmergencySyncRequestDto,
  EmergencySyncResultDto,
  EmergencyEventDto,
  parseEmergencySyncResponse,
  toEmergencyEventDto,
} from '../api/dto/emergencyDto';
import { EmergencyEvent } from '../emergency/domain/EmergencyEvent';
import { SyncStatus } from '../emergency/domain/SyncStatus';
import { EmergencyCoordinator } from '../emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../storage/EmergencyStorageRepository';
import { Session } from '../auth/domain/AuthState';
import { UNCLAIMED_USER_ID } from '../app/identity';

export interface EmergencySyncPolicy {
  batchSize: number;
  retryInitialMs: number;
  retryMaxMs: number;
}

export const DEFAULT_EMERGENCY_SYNC_POLICY: EmergencySyncPolicy = {
  batchSize: 20,
  retryInitialMs: 15_000,
  retryMaxMs: 5 * 60_000,
};

export type EmergencySyncActivity =
  | { kind: 'IDLE' }
  | { kind: 'SYNCING' }
  /** No session: events stay on the phone until someone signs in. */
  | { kind: 'SIGNED_OUT' }
  /** No backend URL in this build. */
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'RETRY_SCHEDULED'; retryInMs: number; lastError: string };

export interface EmergencySyncSnapshot {
  activity: EmergencySyncActivity;
  /** Events currently being uploaded (in memory only; never persisted). */
  syncingEventIds: readonly string[];
  /** Increments whenever stored sync fields change, so views can reload records. */
  revision: number;
}

export interface SessionSource {
  getSession(): Session | null;
  subscribe?(listener: (snapshot: any) => void): () => void;
}

/**
 * The single uploader for emergency events (POST /emergencies/sync).
 *
 * Local-first: EmergencyCoordinator never calls this. The service observes the coordinator and
 * works asynchronously from persisted state, so it survives restarts and never blocks SOS.
 *
 * - Sync state lives on the event record (PENDING / SYNCED / FAILED / LOCAL_ONLY); no second store.
 * - One flush at a time; a request made during a flush runs one more flush afterwards.
 * - Results are applied with compare-and-set on updatedAt: an event changed during upload stays PENDING.
 * - Network/server errors leave events PENDING and schedule a bounded backoff retry (only while
 *   signed in with something pending). No polling otherwise.
 * - Ownership: unclaimed events (recorded while signed out) are uploaded under the signed-in
 *   account and then stamped with it; events of a different account are never uploaded.
 */
export class EmergencySyncService {
  private flushing: Promise<void> | null = null;
  private rerunRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs: number;
  private snapshot: EmergencySyncSnapshot = { activity: { kind: 'IDLE' }, syncingEventIds: [], revision: 0 };
  private readonly listeners = new Set<(snapshot: EmergencySyncSnapshot) => void>();
  private unsubscribeCoordinator: (() => void) | null = null;
  private unsubscribeSessions: (() => void) | null = null;
  private afterFlush: (() => void) | null = null;
  private lastPulledUserId: string | null = null;

  constructor(
    private readonly repository: EmergencyStorageRepository,
    private readonly coordinator: EmergencyCoordinator,
    private readonly api: ApiClient,
    private readonly sessions: SessionSource,
    private readonly policy: EmergencySyncPolicy = DEFAULT_EMERGENCY_SYNC_POLICY
  ) {
    this.retryDelayMs = policy.retryInitialMs;
  }

  /** Begins observing emergency changes. Idempotent. */
  public start(): void {
    if (this.unsubscribeCoordinator) return;
    // Listener is called synchronously from inside the coordinator; only schedule work here.
    this.unsubscribeCoordinator = this.coordinator.subscribeActiveEvent(() => this.requestFlush());
    
    if (this.sessions.subscribe) {
      this.unsubscribeSessions = this.sessions.subscribe((snapshot) => {
        const session = snapshot.session;
        if (session && session.userId !== this.lastPulledUserId) {
          this.lastPulledUserId = session.userId;
          this.pullHistoricalEvents().catch(() => undefined);
        } else if (!session) {
          this.lastPulledUserId = null;
        }
      });
    }
  }

  /** Called after each completed flush (used to flush location points once events are uploaded). */
  public setAfterFlush(callback: (() => void) | null): void {
    this.afterFlush = callback;
  }

  public getSnapshot(): EmergencySyncSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: (snapshot: EmergencySyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Asynchronous request to upload; never runs inside the caller's stack. */
  public requestFlush(): void {
    setTimeout(() => {
      this.flush().catch(() => undefined);
    }, 0);
  }

  /** Uploads pending events. Concurrent callers share the in-progress flush (plus one rerun). */
  public flush(): Promise<void> {
    if (this.flushing) {
      this.rerunRequested = true;
      return this.flushing;
    }
    this.clearRetry();
    this.flushing = (async () => {
      do {
        this.rerunRequested = false;
        await this.runFlush();
      } while (this.rerunRequested && !this.retryTimer);
    })().finally(() => {
      this.flushing = null;
      try {
        this.afterFlush?.();
      } catch {
        // Location upload problems never affect event sync.
      }
    });
    return this.flushing;
  }

  /** Stops timers and observation. Tests / teardown. */
  public dispose(): void {
    this.clearRetry();
    this.unsubscribeCoordinator?.();
    this.unsubscribeCoordinator = null;
    this.unsubscribeSessions?.();
    this.unsubscribeSessions = null;
  }

  /** Signed out: cancel any retry and report the truthful state. */
  public onSignedOut(): void {
    this.clearRetry();
    this.retryDelayMs = this.policy.retryInitialMs;
    this.publish({ activity: { kind: 'SIGNED_OUT' } });
  }

  private async runFlush(): Promise<void> {
    try {
      const session = this.sessions.getSession();
      if (!session) {
        this.publish({ activity: { kind: 'SIGNED_OUT' } });
        return;
      }
      if (!this.api.isConfigured()) {
        this.publish({ activity: { kind: 'NOT_CONFIGURED' } });
        return;
      }

      const initial = (await this.repository.getPendingSyncEvents()).filter((e) => belongsTo(e, session));
      const maxBatches = Math.ceil(initial.length / this.policy.batchSize) + 1;

      for (let batch = 0; batch < maxBatches; batch++) {
        // Re-read each time: an earlier batch or a concurrent lifecycle change may have changed records.
        const current = this.sessions.getSession();
        if (!current || current.userId !== session.userId) {
          this.publish({ activity: { kind: current ? 'IDLE' : 'SIGNED_OUT' } });
          return;
        }
        const pending = (await this.repository.getPendingSyncEvents())
          .filter((e) => belongsTo(e, session))
          .slice(0, this.policy.batchSize);
        if (pending.length === 0) break;

        const outcome = await this.uploadBatch(pending, session);
        if (outcome !== 'CONTINUE') return;
      }

      this.retryDelayMs = this.policy.retryInitialMs;
      this.publish({ activity: { kind: 'IDLE' }, syncingEventIds: [] });
    } catch (e) {
      this.scheduleRetry(e instanceof Error ? e.message : 'Unexpected sync error');
    }
  }

  private async uploadBatch(events: EmergencyEvent[], session: Session): Promise<'CONTINUE' | 'STOP'> {
    const sent = new Map(events.map((e) => [e.eventId, e.updatedAt]));
    this.publish({ activity: { kind: 'SYNCING' }, syncingEventIds: events.map((e) => e.eventId) });

    const body: EmergencySyncRequestDto = { events: events.map((e) => toEmergencyEventDto(e, session)) };
    const res = await this.api.authorizedRequest<unknown>({ method: 'POST', path: '/emergencies/sync', body });

    if (!res.ok) {
      this.handleRequestError(res.error, events);
      return 'STOP';
    }

    const results = parseEmergencySyncResponse(res.data);
    if (!results) {
      this.scheduleRetry('Unexpected server response');
      return 'STOP';
    }

    const answered = new Set<string>();
    for (const result of results) {
      const updatedAt = sent.get(result.eventId);
      if (updatedAt === undefined) continue;
      answered.add(result.eventId);
      await this.repository.applySyncOutcome(result.eventId, updatedAt, outcomePatch(result, session));
    }
    this.publish({ syncingEventIds: [], revision: this.snapshot.revision + 1 });

    if (answered.size < events.length) {
      // Unanswered events stay PENDING.
      this.scheduleRetry('Incomplete server response');
      return 'STOP';
    }
    return 'CONTINUE';
  }

  private handleRequestError(error: ApiError, events: EmergencyEvent[]): void {
    this.publish({ syncingEventIds: [] });
    switch (error.kind) {
      case 'SIGNED_OUT':
        this.onSignedOut();
        return;
      case 'NOT_CONFIGURED':
        this.publish({ activity: { kind: 'NOT_CONFIGURED' } });
        return;
      case 'HTTP':
        if (error.status === 422 || error.status === 400) {
          // The server refuses this request shape; retrying the same batch cannot succeed.
          void this.markRejected(events, error.detail ?? `Rejected by server (HTTP ${error.status})`);
          return;
        }
        this.scheduleRetry(`HTTP ${error.status}`);
        return;
      case 'TIMEOUT':
        this.scheduleRetry('Server did not respond');
        return;
      case 'NETWORK':
        this.scheduleRetry('No connection to server');
        return;
      default:
        this.scheduleRetry('Unexpected server response');
    }
  }

  private async markRejected(events: EmergencyEvent[], message: string): Promise<void> {
    for (const e of events) {
      await this.repository.applySyncOutcome(e.eventId, e.updatedAt, {
        syncStatus: SyncStatus.FAILED,
        syncError: truncate(message),
      });
    }
    this.publish({ activity: { kind: 'IDLE' }, revision: this.snapshot.revision + 1 });
  }

  private scheduleRetry(lastError: string): void {
    this.clearRetry();
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.policy.retryMaxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flush().catch(() => undefined);
    }, delay);
    this.publish({ activity: { kind: 'RETRY_SCHEDULED', retryInMs: delay, lastError }, syncingEventIds: [] });
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private publish(change: Partial<EmergencySyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((l) => l(this.snapshot));
  }

  /** Phase 3I: Pull historical emergencies for this account from backend. Non-blocking. */
  public async pullHistoricalEvents(): Promise<void> {
    try {
      const session = this.sessions.getSession();
      if (!session || !this.api.isConfigured()) return;

      const res = await this.api.authorizedRequest<EmergencyEventDto[]>({
        method: 'GET',
        path: '/emergencies/',
      });
      if (!res.ok || !Array.isArray(res.data)) return; // Fail gracefully offline

      let changed = false;
      for (const dto of res.data) {
        if (!dto.eventId || dto.userId !== session.userId) continue;

        const existing = await this.repository.getEvent(dto.eventId);
        if (!existing) {
          // 1. Insert new historical event
          await this.repository.saveEvent({
            eventId: dto.eventId,
            userId: session.userId,
            deviceId: dto.deviceId,
            triggerSource: dto.triggerSource,
            state: dto.state,
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt,
            resolvedAt: dto.resolvedAt,
            syncStatus: SyncStatus.SYNCED,
            syncedAt: Date.now(),
            syncError: null,
          });
          changed = true;
        } else {
          // 2. Merge existing event if server is newer and local is not PENDING
          // Stale local PENDING events are protected and will overwrite server eventually.
          if (dto.updatedAt > existing.updatedAt && existing.syncStatus !== SyncStatus.PENDING) {
            await this.repository.saveEvent({
              ...existing,
              state: dto.state,
              updatedAt: dto.updatedAt,
              resolvedAt: dto.resolvedAt,
              syncStatus: SyncStatus.SYNCED,
              syncedAt: Date.now(),
              syncError: null,
            });
            changed = true;
          }
        }
      }

      if (changed) {
        // Trigger UI reload
        this.publish({ revision: this.snapshot.revision + 1 });
        // Make sure Zustand store picks it up (since it reads from repository)
        const appContainer = (await import('../app/di/AppContainer')).AppContainer.getInstance();
        const emergencyStore = (await import('../emergency/store/emergencyStore')).useEmergencyStore.getState();
        await emergencyStore.loadAllEvents();
      }
    } catch (error) {
      // Offline or network error: fail gracefully without blocking
    }
  }
}

/** Unclaimed (recorded signed out) or already owned by this account. */
export function belongsTo(event: EmergencyEvent, session: Session): boolean {
  return event.userId === UNCLAIMED_USER_ID || event.userId === session.userId;
}

function outcomePatch(result: EmergencySyncResultDto, session: Session) {
  if (result.status === 'FAILED') {
    return { syncStatus: SyncStatus.FAILED, syncError: truncate(result.message ?? 'Rejected by server') };
  }
  const serverTime = Date.parse(result.serverReceivedAt);
  return {
    syncStatus: SyncStatus.SYNCED,
    syncedAt: Number.isFinite(serverTime) ? serverTime : Date.now(),
    syncError: null,
    // The server now holds this event under the account; record the claim locally.
    userId: session.userId,
    deviceId: session.deviceId,
  };
}

function truncate(message: string): string {
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}
