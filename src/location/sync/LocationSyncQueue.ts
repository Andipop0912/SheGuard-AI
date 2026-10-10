import { LocationPolicy } from '../../config/locationPolicy';
import { EmergencyLocationPoint, EmergencyLocationRepository } from '../storage/EmergencyLocationRepository';
import { LocationSyncTransport } from './LocationSyncTransport';

export type LocationSyncState =
  | { kind: 'IDLE'; pending: number }
  | { kind: 'SYNCING'; pending: number }
  | { kind: 'NOT_CONNECTED'; pending: number }
  | { kind: 'RETRY_SCHEDULED'; pending: number; retryInMs: number; lastError: string };

/**
 * The single uploader for emergency location points.
 *
 * - Local points are never deleted by sync; outcomes only change their status.
 * - One flush runs at a time (no duplicate workers).
 * - Retryable failures back off exponentially. NOT_CONNECTED does not schedule retries:
 *   nothing changes until an authenticated transport exists, so flush() is called again then.
 */
export class LocationSyncQueue {
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs: number;
  private state: LocationSyncState = { kind: 'IDLE', pending: 0 };
  private readonly listeners = new Set<(state: LocationSyncState) => void>();

  constructor(
    private readonly repository: EmergencyLocationRepository,
    private transport: LocationSyncTransport,
    private readonly policy: LocationPolicy
  ) {
    this.retryDelayMs = policy.syncRetryInitialMs;
  }

  public getState(): LocationSyncState {
    return this.state;
  }

  public subscribe(listener: (state: LocationSyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Swaps the transport (e.g. once the API client is authenticated) and flushes. */
  public setTransport(transport: LocationSyncTransport): Promise<void> {
    this.transport = transport;
    return this.flush();
  }

  /** Uploads pending points. Concurrent callers share the same in-progress flush. */
  public flush(): Promise<void> {
    if (!this.flushing) {
      this.clearRetry();
      this.flushing = this.runFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  /** Cancels any scheduled retry. Tests and teardown only. */
  public dispose(): void {
    this.clearRetry();
  }

  private async runFlush(): Promise<void> {
    try {
      // Bounded loop: at most enough batches to drain everything that was pending at the start.
      const initialPending = await this.repository.countPending();
      const maxBatches = Math.ceil(initialPending / this.policy.syncBatchSize) + 1;

      for (let batch = 0; batch < maxBatches; batch++) {
        const pending = await this.repository.getPendingPoints(this.policy.syncBatchSize);
        if (pending.length === 0) break;
        this.setState({ kind: 'SYNCING', pending: await this.repository.countPending() });

        const outcome = await this.sendGroupedByEvent(pending);
        if (outcome === 'STOP_NOT_CONNECTED') {
          this.setState({ kind: 'NOT_CONNECTED', pending: await this.repository.countPending() });
          return;
        }
        if (outcome !== 'CONTINUE') {
          this.scheduleRetry(outcome.error);
          return;
        }
      }

      this.retryDelayMs = this.policy.syncRetryInitialMs;
      this.setState({ kind: 'IDLE', pending: await this.repository.countPending() });
    } catch (e) {
      this.scheduleRetry(e instanceof Error ? e.message : 'Unexpected sync error');
    }
  }

  /**
   * One batch can hold points from several emergencies. A single event that is not yet synced
   * (or otherwise fails) must never block the others' points sitting later in the same batch —
   * every event group is always attempted; the worst outcome is reported (and still schedules a
   * retry) only after all of them have had a chance to upload.
   */
  private async sendGroupedByEvent(
    points: EmergencyLocationPoint[]
  ): Promise<'CONTINUE' | 'STOP_NOT_CONNECTED' | { error: string }> {
    const byEvent = new Map<string, EmergencyLocationPoint[]>();
    points.forEach((p) => byEvent.set(p.eventId, [...(byEvent.get(p.eventId) ?? []), p]));

    let firstError: string | null = null;

    for (const [eventId, eventPoints] of byEvent) {
      const ids = eventPoints.map((p) => p.locationId);
      let result;
      try {
        result = await this.transport.send(eventId, eventPoints);
      } catch (e) {
        result = { kind: 'RETRYABLE_ERROR' as const, message: e instanceof Error ? e.message : 'Transport error' };
      }

      switch (result.kind) {
        case 'NOT_CONNECTED':
          // Transport-level (not per-event): true for every remaining group in this call too.
          return 'STOP_NOT_CONNECTED';
        case 'EVENT_NOT_SYNCED':
          await this.repository.markAttemptFailed(ids, 'Emergency not yet on server');
          firstError ??= 'Emergency not yet on server';
          continue;
        case 'RETRYABLE_ERROR':
          await this.repository.markAttemptFailed(ids, result.message);
          firstError ??= result.message;
          continue;
        case 'RESULTS': {
          const synced: string[] = [];
          const rejected = new Map<string, string>();
          const answered = new Set<string>();
          for (const r of result.results) {
            answered.add(r.locationId);
            if (r.status === 'SYNCED' || r.status === 'ALREADY_SYNCED') synced.push(r.locationId);
            else rejected.set(r.locationId, r.message ?? 'Rejected by server');
          }
          await this.repository.markSynced(synced);
          for (const [id, message] of rejected) {
            await this.repository.markRejected([id], message);
          }
          const unanswered = ids.filter((id) => !answered.has(id));
          if (unanswered.length > 0) {
            await this.repository.markAttemptFailed(unanswered, 'No result returned for point');
            firstError ??= 'Incomplete server response';
          }
          break;
        }
      }
    }
    return firstError ? { error: firstError } : 'CONTINUE';
  }

  private scheduleRetry(error: string): void {
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.policy.syncRetryMaxMs);
    this.repository.countPending().then((pending) => {
      this.setState({ kind: 'RETRY_SCHEDULED', pending, retryInMs: delay, lastError: error });
    });
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flush();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setState(state: LocationSyncState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
