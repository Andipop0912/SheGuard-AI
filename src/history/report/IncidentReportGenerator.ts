import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { EmergencyState } from '../../emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { SyncStatus } from '../../emergency/domain/SyncStatus';
import { CommunicationRecord } from '../../communication/domain/CommunicationRecord';
import { EmergencyLocationSummary } from '../../location/storage/EmergencyLocationRepository';
import { EmergencyLocationStatus } from '../../location/domain/LocationState';
import { EvidenceItem } from '../../evidence/domain/EvidenceItem';

export interface IncidentTimelineEntry {
  label: string;
  timestamp: number | null;
}

export interface IncidentReportInput {
  event: EmergencyEvent;
  locationSummary: EmergencyLocationSummary | null;
  /** null = never fetched (e.g. not signed in / never synced); [] = fetched, no records. */
  communication: CommunicationRecord[] | null;
  evidence: EvidenceItem[];
}

export interface IncidentReport {
  incidentId: string;
  generatedAt: number;
  date: number;
  trigger: EmergencyTriggerSource;
  status: EmergencyState;
  timeline: IncidentTimelineEntry[];
  locationText: string;
  communicationLines: string[];
  evidenceLines: string[];
  syncText: string;
  summary: string;
  /** Full plain-text rendering, ready to display or export. */
  text: string;
}

function formatDate(ms: number | null): string {
  if (ms == null) return 'Unknown';
  return new Date(ms).toLocaleString();
}

function triggerLabel(source: EmergencyTriggerSource): string {
  switch (source) {
    case EmergencyTriggerSource.MANUAL_SOS:
      return 'MANUAL_SOS';
    case EmergencyTriggerSource.VOICE:
      return 'VOICE';
    case EmergencyTriggerSource.GESTURE:
      return 'GESTURE';
    case EmergencyTriggerSource.HARDWARE_BUTTON:
      return 'HARDWARE';
    default:
      return String(source);
  }
}

function locationText(summary: EmergencyLocationSummary | null): string {
  if (!summary) return 'Unavailable — no location was captured for this incident';
  switch (summary.status) {
    case EmergencyLocationStatus.AVAILABLE:
      return 'Available — a fresh location fix was captured';
    case EmergencyLocationStatus.STALE:
      return 'Available (stale) — a last-known location fix was captured';
    case EmergencyLocationStatus.PENDING:
      return 'Pending — no fix was obtained before the incident closed';
    case EmergencyLocationStatus.UNAVAILABLE:
    default:
      return `Unavailable${summary.reason ? ` (${summary.reason})` : ''}`;
  }
}

/** "Provider accepted" per record, never "Delivered" unless the provider confirmed delivery. */
function communicationLine(record: CommunicationRecord): string {
  const channel = record.channel;
  const who = record.contactDeleted ? `${record.contactName} (contact later removed)` : record.contactName;
  switch (record.status) {
    case 'DELIVERED':
      return `${who} — ${channel} — Delivered${record.isSimulated ? ' (simulated)' : ''}`;
    case 'PROVIDER_ACCEPTED':
      return `${who} — ${channel} — Provider accepted${record.isSimulated ? ' (simulated)' : ''}`;
    case 'DISPATCHED':
      return `${who} — ${channel} — Dispatched (awaiting provider response)`;
    case 'QUEUED':
      return `${who} — ${channel} — Queued`;
    case 'FAILED':
      return `${who} — ${channel} — Failed${record.failureReason ? `: ${record.failureReason}` : ''}`;
    case 'NOT_SENT':
      return `${who} — ${channel} — Not sent${record.reasonCode ? ` (${record.reasonCode})` : ''}`;
    case 'UNCERTAIN':
    default:
      return `${who} — ${channel} — Status uncertain`;
  }
}

function evidenceLine(item: EvidenceItem, index: number): string {
  const seconds = Math.round(item.durationMs / 1000);
  return `Audio recording ${index + 1} — ${formatDate(item.createdAt)} — duration ${Math.floor(seconds / 60)}:${(seconds % 60)
    .toString()
    .padStart(2, '0')} — stored on this device`;
}

function syncText(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.SYNCED:
      return 'SYNCED — backed up to the server';
    case SyncStatus.PENDING:
      return 'PENDING — not yet backed up';
    case SyncStatus.FAILED:
      return 'FAILED — server backup did not complete';
    case SyncStatus.LOCAL_ONLY:
      return 'LOCAL — recorded on this phone only';
    default:
      return String(status);
  }
}

/**
 * Builds a factual incident report from data already stored by the app — never fabricates
 * timestamps, location, communication outcomes or anything SheGuard did not itself record.
 */
export function generateIncidentReport(input: IncidentReportInput): IncidentReport {
  const { event, locationSummary, communication, evidence } = input;

  const timeline: IncidentTimelineEntry[] = [{ label: 'Emergency triggered', timestamp: event.createdAt }];
  if (locationSummary && locationSummary.status !== EmergencyLocationStatus.UNAVAILABLE) {
    timeline.push({ label: 'Location acquired', timestamp: locationSummary.updatedAt });
  }
  evidence.forEach((item) => timeline.push({ label: 'Evidence recorded', timestamp: item.createdAt }));
  (communication ?? [])
    .filter((r) => r.status === 'PROVIDER_ACCEPTED' || r.status === 'DELIVERED' || r.status === 'DISPATCHED')
    .forEach((r) => timeline.push({ label: `Contact alert ${r.status === 'DISPATCHED' ? 'dispatched' : 'accepted by provider'} — ${r.contactName}`, timestamp: null }));
  if (event.resolvedAt) timeline.push({ label: 'Emergency resolved', timestamp: event.resolvedAt });
  timeline.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));

  const communicationLines =
    communication === null
      ? ['Not available — not signed in or never synced to the server']
      : communication.length === 0
      ? ['No contacts alerted']
      : communication.map(communicationLine);

  const evidenceLines = evidence.length === 0 ? ['No evidence recorded'] : evidence.map((item, i) => evidenceLine(item, i));

  const summaryParts = [
    `This incident was triggered by ${triggerLabel(event.triggerSource)} on ${formatDate(event.createdAt)} and is currently ${event.state}.`,
    locationSummary && locationSummary.status !== EmergencyLocationStatus.UNAVAILABLE
      ? 'A location fix was captured for this incident.'
      : 'No location fix was captured for this incident.',
    evidence.length > 0
      ? `${evidence.length} audio recording(s) were saved for this incident.`
      : 'No audio evidence was recorded for this incident.',
    communication && communication.length > 0
      ? `${communication.length} trusted contact communication record(s) exist for this incident.`
      : 'No trusted contact communication records exist for this incident.',
  ];
  const summary = summaryParts.join(' ');

  const lt = locationText(locationSummary);
  const st = syncText(event.syncStatus);

  const text = [
    '================================',
    'SHEGUARD INCIDENT REPORT',
    '================================',
    '',
    `Incident ID: ${event.eventId}`,
    `Date: ${formatDate(event.createdAt)}`,
    `Trigger: ${triggerLabel(event.triggerSource)}`,
    `Status: ${event.state}`,
    '',
    'Timeline:',
    ...timeline.map((t) => `  - ${t.label}${t.timestamp ? ` (${formatDate(t.timestamp)})` : ''}`),
    '',
    `Location: ${lt}`,
    '',
    'Communication:',
    ...communicationLines.map((l) => `  - ${l}`),
    '',
    'Evidence:',
    ...evidenceLines.map((l) => `  - ${l}`),
    '',
    `Synchronization: ${st}`,
    '',
    '================================',
    'AI-GENERATED SUMMARY (based only on recorded facts above)',
    '================================',
    summary,
  ].join('\n');

  return {
    incidentId: event.eventId,
    generatedAt: Date.now(),
    date: event.createdAt,
    trigger: event.triggerSource,
    status: event.state,
    timeline,
    locationText: lt,
    communicationLines,
    evidenceLines,
    syncText: st,
    summary,
    text,
  };
}
