import { EvidenceSyncStatus } from '../domain/EvidenceItem';
import { EvidenceRepository } from '../storage/EvidenceRepository';
import { EvidenceUploadTransport } from './EvidenceUploadTransport';

export type EvidenceSyncState =
  | { kind: 'IDLE'; pending: number }
  | { kind: 'SYNCING'; pending: number }
  | { kind: 'NOT_CONNECTED'; pending: number }
  | { kind: 'RETRY_SCHEDULED'; pending: number; retryInMs: number; lastError: string };

const INITIAL_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

/**
 * The single uploader for recorded evidence files, mirroring LocationSyncQueue: local files are
 * never deleted by sync, only one flush runs at a time, and one item's failure never blocks the
 * others (each item is an independent multipart upload, so unlike location points there is no
 * grouping to do).
 */
export class EvidenceSyncQueue {
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = INITIAL_RETRY_MS;
  private state: EvidenceSyncState = { kind: 'IDLE', pending: 0 };
  private readonly listeners = new Set<(state: EvidenceSyncState) => void>();

  constructor(
    private readonly repository: EvidenceRepository,
    private transport: EvidenceUploadTransport
  ) {}

  public getState(): EvidenceSyncState {
    return this.state;
  }

  public subscribe(listener: (state: EvidenceSyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Swaps the transport (e.g. once the API client is authenticated) and flushes. */
  public setTransport(transport: EvidenceUploadTransport): Promise<void> {
    this.transport = transport;
    return this.flush();
  }

  /** Uploads every pending item. Concurrent callers share the same in-progress flush. */
  public flush(): Promise<void> {
    if (!this.flushing) {
      this.clearRetry();
      this.flushing = this.runFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  public dispose(): void {
    this.clearRetry();
  }

  private async pendingItems() {
    const all = await this.repository.getAll();
    // FAILED is permanent (server rejected the file outright) — it never gets uploaded; do not
    // keep counting or retrying it as pending.
    return all.filter((item) => item.syncStatus === EvidenceSyncStatus.LOCAL_ONLY);
  }

  private async runFlush(): Promise<void> {
    try {
      const pending = await this.pendingItems();
      if (pending.length === 0) {
        this.setState({ kind: 'IDLE', pending: 0 });
        return;
      }
      this.setState({ kind: 'SYNCING', pending: pending.length });

      let firstError: string | null = null;
      for (const item of pending) {
        let result;
        try {
          result = await this.transport.upload(item);
        } catch (e) {
          result = { kind: 'RETRYABLE_ERROR' as const, message: e instanceof Error ? e.message : 'Transport error' };
        }

        switch (result.kind) {
          case 'NOT_CONNECTED':
            this.setState({ kind: 'NOT_CONNECTED', pending: (await this.pendingItems()).length });
            return;
          case 'SUCCESS':
            await this.repository.updateSyncStatus(item.evidenceId, EvidenceSyncStatus.UPLOADED);
            break;
          case 'REJECTED':
            // Permanent failure: marked FAILED so it is not retried forever; the local file remains the record.
            await this.repository.updateSyncStatus(item.evidenceId, EvidenceSyncStatus.FAILED);
            break;
          case 'EVENT_NOT_SYNCED':
          case 'RETRYABLE_ERROR':
            firstError ??= result.kind === 'RETRYABLE_ERROR' ? result.message : 'Emergency not yet on server';
            break;
        }
      }

      if (firstError) {
        this.scheduleRetry(firstError);
        return;
      }
      this.retryDelayMs = INITIAL_RETRY_MS;
      this.setState({ kind: 'IDLE', pending: (await this.pendingItems()).length });
    } catch (e) {
      this.scheduleRetry(e instanceof Error ? e.message : 'Unexpected sync error');
    }
  }

  private scheduleRetry(error: string): void {
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_MS);
    this.pendingItems().then((pending) => {
      this.setState({ kind: 'RETRY_SCHEDULED', pending: pending.length, retryInMs: delay, lastError: error });
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

  private setState(state: EvidenceSyncState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
