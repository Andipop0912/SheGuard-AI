/**
 * A communication record created by the SERVER for one emergency + contact + channel
 * (backend/app/schemas/communication.py CommunicationLogDTO). The app only reads these.
 */
export type CommunicationStatus =
  | 'QUEUED'
  | 'DISPATCHED'
  | 'PROVIDER_ACCEPTED'
  | 'DELIVERED'
  | 'FAILED'
  | 'NOT_SENT'
  | 'UNCERTAIN';

export interface CommunicationRecord {
  readonly id: string;
  readonly eventId: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactDeleted: boolean;
  readonly channel: 'SMS' | 'FCM' | 'VOICE_CALL';
  readonly status: CommunicationStatus;
  readonly reasonCode: string | null;
  readonly failureReason: string | null;
  /** Development simulator: nothing was really sent. */
  readonly isSimulated: boolean;
  readonly attemptCount: number;
}

/** Statuses that will not change any more. */
export const FINAL_STATUSES: ReadonlySet<CommunicationStatus> = new Set([
  'PROVIDER_ACCEPTED',
  'DELIVERED',
  'FAILED',
  'NOT_SENT',
  'UNCERTAIN',
]);

interface CommunicationLogDto {
  id: string;
  event_id: string;
  contact_name: string;
  contact_phone: string;
  contact_deleted: boolean;
  channel: CommunicationRecord['channel'];
  status: CommunicationStatus;
  reason_code: string | null;
  failure_reason: string | null;
  is_simulated: boolean;
  attempt_count: number;
}

const STATUSES: readonly string[] = ['QUEUED', 'DISPATCHED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'NOT_SENT', 'UNCERTAIN'];

export function parseCommunicationLogs(body: unknown): CommunicationRecord[] | null {
  if (!Array.isArray(body)) return null;
  const records: CommunicationRecord[] = [];
  for (const item of body as Partial<CommunicationLogDto>[]) {
    if (!item || typeof item.id !== 'string' || typeof item.status !== 'string' || !STATUSES.includes(item.status)) {
      return null;
    }
    records.push({
      id: item.id,
      eventId: item.event_id ?? '',
      contactName: item.contact_name ?? 'Contact',
      contactPhone: item.contact_phone ?? '',
      contactDeleted: !!item.contact_deleted,
      channel: (item.channel ?? 'SMS') as CommunicationRecord['channel'],
      status: item.status as CommunicationStatus,
      reasonCode: item.reason_code ?? null,
      failureReason: item.failure_reason ?? null,
      isSimulated: !!item.is_simulated,
      attemptCount: typeof item.attempt_count === 'number' ? item.attempt_count : 0,
    });
  }
  return records;
}
