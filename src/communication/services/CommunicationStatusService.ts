import { ApiClient } from '../../api/ApiClient';
import { CommunicationRecord, FINAL_STATUSES, parseCommunicationLogs } from '../domain/CommunicationRecord';

export interface CommunicationStatusSnapshot {
  eventId: string;
  records: CommunicationRecord[] | null;
  activeContactCount: number | null;
  fetchFailed: boolean;
}

export interface CommunicationPollPolicy {
  /** Delay between polls while alerts are being prepared or sent. */
  intervalMs: number;
  /** Hard stop for one watch. */
  maxDurationMs: number;
}

export const DEFAULT_COMMUNICATION_POLL_POLICY: CommunicationPollPolicy = {
  intervalMs: 3_000,
  maxDurationMs: 3 * 60_000,
};

/**
 * Reads the server's communication records for an emergency. Read-only: sending is done by the
 * server. Polls only while watched (the Emergency screen is showing a synced emergency) and only
 * while alerts are still being prepared or sent; stops at the time limit. Never on the SOS path.
 */
export class CommunicationStatusService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchToken = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly policy: CommunicationPollPolicy = DEFAULT_COMMUNICATION_POLL_POLICY
  ) {}

  public watch(eventId: string, onUpdate: (snapshot: CommunicationStatusSnapshot) => void): () => void {
    this.stop();
    const token = ++this.watchToken;
    const startedAt = Date.now();
    let activeContactCount: number | null = null;
    let lastRecords: CommunicationRecord[] | null = null;

    const tick = async () => {
      if (token !== this.watchToken) return;
      const records = await this.fetchRecords(eventId);
      if (token !== this.watchToken) return;
      if (records && records.length === 0 && activeContactCount === null) {
        activeContactCount = await this.fetchActiveContactCount();
        if (token !== this.watchToken) return;
      }
      if (records) lastRecords = records;
      onUpdate({ eventId, records: lastRecords, activeContactCount, fetchFailed: records === null });

      const settled =
        records !== null &&
        ((records.length > 0 && records.every((r) => FINAL_STATUSES.has(r.status))) ||
          (records.length === 0 && activeContactCount === 0));
      if (settled || Date.now() - startedAt >= this.policy.maxDurationMs) {
        if (token === this.watchToken) this.timer = null;
        return;
      }
      this.timer = setTimeout(tick, this.policy.intervalMs);
    };

    void tick();
    return () => {
      if (token === this.watchToken) this.stop();
    };
  }

  public stop(): void {
    this.watchToken++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async fetchRecords(eventId: string): Promise<CommunicationRecord[] | null> {
    try {
      const res = await this.api.authorizedRequest<unknown>({
        method: 'GET',
        path: `/emergency/communication/logs/${encodeURIComponent(eventId)}`,
      });
      return res.ok ? parseCommunicationLogs(res.data) : null;
    } catch {
      return null;
    }
  }

  private async fetchActiveContactCount(): Promise<number | null> {
    try {
      const res = await this.api.authorizedRequest<unknown>({ method: 'GET', path: '/contacts' });
      return res.ok && Array.isArray(res.data) ? res.data.length : null;
    } catch {
      return null;
    }
  }
}
