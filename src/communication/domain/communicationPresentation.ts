import { SyncStatus } from '../../emergency/domain/SyncStatus';
import { BadgeTone } from '../../design/components/EmergencyComponents';
import { CommunicationRecord, FINAL_STATUSES } from './CommunicationRecord';

export interface ContactAlertsInput {
  signedIn: boolean;
  /** The emergency's own sync state (alerts are sent by the server after it arrives). */
  eventSyncStatus: SyncStatus;
  /** null = not fetched yet. */
  records: readonly CommunicationRecord[] | null;
  /** Active contacts on the server, when known. */
  activeContactCount: number | null;
  /** The last status request failed (shown only when nothing is known yet). */
  fetchFailed: boolean;
}

export interface PresentedContactAlerts {
  status: string;
  badge: { text: string; tone: BadgeTone };
  /** One line per contact record. */
  lines: string[];
}

const NOT_SENT_LABELS: Record<string, string> = {
  emergency_already_resolved: 'NOT SENT • EMERGENCY RESOLVED',
  emergency_already_cancelled: 'NOT SENT • EMERGENCY CANCELLED',
  dispatch_cancelled_emergency_resolved: 'NOT SENT • DISPATCH CANCELLED (RESOLVED)',
  dispatch_cancelled_emergency_cancelled: 'NOT SENT • DISPATCH CANCELLED (CANCELLED)',
  channel_not_available: 'NOT SENT • CHANNEL NOT AVAILABLE',
  contact_inactive: 'NOT SENT • CONTACT INACTIVE',
};

/**
 * Label for one record. Never claims delivery or reading: provider acceptance is shown as
 * acceptance, simulated sends are always marked SIMULATED, and a timeout is shown as uncertain.
 */
export function presentRecordStatus(record: CommunicationRecord): string {
  const sim = record.isSimulated ? 'SIMULATED • ' : '';
  switch (record.status) {
    case 'QUEUED':
    case 'DISPATCHED':
      return `${sim}SENDING…`;
    case 'PROVIDER_ACCEPTED':
      return record.isSimulated ? 'SIMULATED • ACCEPTED' : 'ACCEPTED BY SMS PROVIDER';
    case 'DELIVERED':
      // Only real provider evidence counts as delivery; a simulator cannot deliver anything.
      return record.isSimulated ? 'SIMULATED • ACCEPTED' : 'DELIVERED (PROVIDER CONFIRMED)';
    case 'FAILED':
      return `${sim}FAILED`;
    case 'UNCERTAIN':
      return `${sim}NO PROVIDER RESPONSE • MAY NOT HAVE BEEN SENT`;
    case 'NOT_SENT':
    default:
      return (record.reasonCode && NOT_SENT_LABELS[record.reasonCode]) || 'NOT SENT';
  }
}

function recordLine(record: CommunicationRecord): string {
  const channel = record.channel === 'SMS' ? '' : ` (${record.channel})`;
  const removed = record.contactDeleted ? ' (removed)' : '';
  return `${record.contactName}${removed}${channel}: ${presentRecordStatus(record)}`;
}

export function presentContactAlerts(input: ContactAlertsInput): PresentedContactAlerts {
  if (input.eventSyncStatus === SyncStatus.LOCAL_ONLY) {
    return {
      status: 'Not sent — this emergency was recorded before server backup existed',
      badge: { text: 'Not sent', tone: 'neutral' },
      lines: [],
    };
  }
  if (!input.signedIn) {
    return {
      status: 'Not sent — sign in to alert your trusted contacts',
      badge: { text: 'Not sent', tone: 'neutral' },
      lines: [],
    };
  }
  if (input.eventSyncStatus === SyncStatus.FAILED) {
    return {
      status: 'Not sent — the server did not accept this emergency',
      badge: { text: 'Not sent', tone: 'neutral' },
      lines: [],
    };
  }
  if (input.eventSyncStatus !== SyncStatus.SYNCED) {
    return {
      status: 'Contacts will be alerted once this emergency reaches the server',
      badge: { text: 'Waiting', tone: 'pending' },
      lines: [],
    };
  }
  if (input.records === null) {
    return {
      status: input.fetchFailed ? 'Alert status unavailable right now' : 'Checking alert status…',
      badge: { text: 'Checking', tone: 'pending' },
      lines: [],
    };
  }
  if (input.records.length === 0) {
    if (input.activeContactCount === 0) {
      return {
        status: 'Not sent — you have no active trusted contacts',
        badge: { text: 'Not sent', tone: 'neutral' },
        lines: [],
      };
    }
    return { status: 'Preparing alerts…', badge: { text: 'Preparing', tone: 'pending' }, lines: [] };
  }

  const lines = input.records.map(recordLine);
  const inProgress = input.records.some((r) => !FINAL_STATUSES.has(r.status));
  const accepted = input.records.filter((r) => r.status === 'PROVIDER_ACCEPTED' || r.status === 'DELIVERED');
  const simulated = input.records.some((r) => r.isSimulated);

  if (inProgress) {
    return { status: lines.join('\n'), badge: { text: 'Sending', tone: 'pending' }, lines };
  }
  if (accepted.length > 0) {
    return {
      status: lines.join('\n'),
      badge: simulated ? { text: 'Simulated', tone: 'neutral' } : { text: 'Accepted', tone: 'active' },
      lines,
    };
  }
  if (input.records.every((r) => r.status === 'NOT_SENT')) {
    return { status: lines.join('\n'), badge: { text: 'Not sent', tone: 'neutral' }, lines };
  }
  // Only failures / no-response outcomes (with or without NOT_SENT records).
  return {
    status: lines.join('\n'),
    badge: { text: simulated ? 'Simulated' : 'Failed', tone: 'neutral' },
    lines,
  };
}
