import { generateIncidentReport } from '../../src/history/report/IncidentReportGenerator';
import { createEmergencyEvent } from '../../src/emergency/domain/EmergencyEvent';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyLocationStatus, LocationUnavailableReason } from '../../src/location/domain/LocationState';
import { EvidenceItem, EvidenceSyncStatus, EvidenceType } from '../../src/evidence/domain/EvidenceItem';
import { CommunicationRecord } from '../../src/communication/domain/CommunicationRecord';

const NOW = 1_800_000_000_000;

function baseEvent(overrides: Partial<Parameters<typeof createEmergencyEvent>[0]> = {}) {
  return createEmergencyEvent({
    eventId: 'evt-1',
    userId: 'u',
    deviceId: 'd',
    triggerSource: EmergencyTriggerSource.MANUAL_SOS,
    createdAt: NOW,
    ...overrides,
  });
}

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: 'ev-1',
    eventId: 'evt-1',
    type: EvidenceType.AUDIO,
    filePath: '/fake/ev-1.m4a',
    createdAt: NOW + 1_000,
    durationMs: 65_000,
    syncStatus: EvidenceSyncStatus.LOCAL_ONLY,
    ...overrides,
  };
}

function commRecord(overrides: Partial<CommunicationRecord> = {}): CommunicationRecord {
  return {
    id: 'c-1',
    eventId: 'evt-1',
    contactName: 'Bhoomi',
    contactPhone: '+919326754208',
    contactDeleted: false,
    channel: 'SMS',
    status: 'PROVIDER_ACCEPTED',
    reasonCode: null,
    failureReason: null,
    isSimulated: true,
    attemptCount: 1,
    ...overrides,
  };
}

describe('generateIncidentReport (facts only, never fabricated)', () => {
  test('builds a report from real data only: trigger, status, incident id', () => {
    const report = generateIncidentReport({
      event: baseEvent({ triggerSource: EmergencyTriggerSource.VOICE, state: EmergencyState.RESOLVED, resolvedAt: NOW + 5_000 }),
      locationSummary: null,
      communication: null,
      evidence: [],
    });

    expect(report.incidentId).toBe('evt-1');
    expect(report.trigger).toBe(EmergencyTriggerSource.VOICE);
    expect(report.status).toBe(EmergencyState.RESOLVED);
    expect(report.text).toContain('Incident ID: evt-1');
    expect(report.text).toContain('Trigger: VOICE');
  });

  test('timeline is chronologically ordered and only contains real recorded events', () => {
    const report = generateIncidentReport({
      event: baseEvent({ state: EmergencyState.RESOLVED, resolvedAt: NOW + 10_000 }),
      locationSummary: { eventId: 'evt-1', status: EmergencyLocationStatus.AVAILABLE, reason: null, updatedAt: NOW + 2_000 },
      communication: [commRecord({ status: 'DISPATCHED' })],
      evidence: [evidence({ createdAt: NOW + 5_000 })],
    });

    const timestamps = report.timeline.map((t) => t.timestamp).filter((t): t is number => t !== null);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    // "Contact alert dispatched" has no known timestamp (dispatch is async and may continue
    // after resolve), so it is never placed ahead of a timestamped event — it sorts last.
    expect(report.timeline.map((t) => t.label)).toEqual([
      'Emergency triggered',
      'Location acquired',
      'Evidence recorded',
      'Emergency resolved',
      'Contact alert dispatched — Bhoomi',
    ]);
  });

  test('evidence section lists every recording with its real duration, associated with this incident only', () => {
    const report = generateIncidentReport({
      event: baseEvent(),
      locationSummary: null,
      communication: null,
      evidence: [evidence({ evidenceId: 'ev-1', durationMs: 65_000 }), evidence({ evidenceId: 'ev-2', durationMs: 5_000 })],
    });

    expect(report.evidenceLines).toHaveLength(2);
    expect(report.evidenceLines[0]).toContain('1:05');
    expect(report.evidenceLines[1]).toContain('0:05');
  });

  test('missing location is reported truthfully, never fabricated', () => {
    const report = generateIncidentReport({
      event: baseEvent(),
      locationSummary: { eventId: 'evt-1', status: EmergencyLocationStatus.UNAVAILABLE, reason: LocationUnavailableReason.PERMISSION, updatedAt: NOW },
      communication: null,
      evidence: [],
    });

    expect(report.locationText).toContain('Unavailable');
    expect(report.locationText).toContain('PERMISSION');
    expect(report.timeline.find((t) => t.label === 'Location acquired')).toBeUndefined();
  });

  test('communication not available (not signed in / never synced) is distinguished from zero contacts alerted', () => {
    const notAvailable = generateIncidentReport({ event: baseEvent(), locationSummary: null, communication: null, evidence: [] });
    expect(notAvailable.communicationLines[0]).toContain('Not available');

    const zeroContacts = generateIncidentReport({ event: baseEvent(), locationSummary: null, communication: [], evidence: [] });
    expect(zeroContacts.communicationLines[0]).toBe('No contacts alerted');
  });

  test('provider acceptance is never reported as "Delivered" unless the record says DELIVERED', () => {
    const accepted = generateIncidentReport({
      event: baseEvent(),
      locationSummary: null,
      communication: [commRecord({ status: 'PROVIDER_ACCEPTED' })],
      evidence: [],
    });
    expect(accepted.communicationLines[0]).toContain('Provider accepted');
    expect(accepted.communicationLines[0]).not.toContain('Delivered');

    const delivered = generateIncidentReport({
      event: baseEvent(),
      locationSummary: null,
      communication: [commRecord({ status: 'DELIVERED' })],
      evidence: [],
    });
    expect(delivered.communicationLines[0]).toContain('Delivered');
  });

  test('two incidents never share evidence or communication data', () => {
    const reportA = generateIncidentReport({
      event: baseEvent({ eventId: 'evt-A' }),
      locationSummary: null,
      communication: null,
      evidence: [evidence({ eventId: 'evt-A', evidenceId: 'ev-A', durationMs: 65_000 })],
    });
    const reportB = generateIncidentReport({
      event: baseEvent({ eventId: 'evt-B' }),
      locationSummary: null,
      communication: null,
      evidence: [evidence({ eventId: 'evt-B', evidenceId: 'ev-B', durationMs: 12_000 })],
    });

    expect(reportA.incidentId).not.toBe(reportB.incidentId);
    expect(reportA.evidenceLines[0]).toContain('1:05');
    expect(reportB.evidenceLines[0]).toContain('0:12');
    expect(reportA.evidenceLines[0]).not.toEqual(reportB.evidenceLines[0]);
  });

  test('sync status is reported as the real stored value, including LOCAL_ONLY', () => {
    const report = generateIncidentReport({
      event: baseEvent({ syncStatus: SyncStatus.LOCAL_ONLY }),
      locationSummary: null,
      communication: null,
      evidence: [],
    });
    expect(report.syncText).toContain('LOCAL');
  });
});
