import {
  presentContactAlerts,
  presentRecordStatus,
} from '../../src/communication/domain/communicationPresentation';
import { CommunicationRecord, parseCommunicationLogs } from '../../src/communication/domain/CommunicationRecord';
import { CommunicationStatusService } from '../../src/communication/services/CommunicationStatusService';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { getEventOwner, resetIdentityForTesting } from '../../src/app/identity';
import { buildStack, fakeCommunicationLog, settle } from '../net/fakes';

const rec = (over: Partial<CommunicationRecord>): CommunicationRecord => ({
  id: 'l1',
  eventId: 'e',
  contactName: 'Mom',
  contactPhone: '+919876543210',
  contactDeleted: false,
  channel: 'SMS',
  status: 'PROVIDER_ACCEPTED',
  reasonCode: null,
  failureReason: null,
  isSimulated: true,
  attemptCount: 1,
  ...over,
});

const base = { signedIn: true, eventSyncStatus: SyncStatus.SYNCED, activeContactCount: null, fetchFailed: false };

describe('truthful contact-alert presentation (D6, D11)', () => {
  test('record labels never claim delivery/read; simulated is always marked', () => {
    expect(presentRecordStatus(rec({}))).toBe('SIMULATED • ACCEPTED');
    expect(presentRecordStatus(rec({ isSimulated: false }))).toBe('ACCEPTED BY SMS PROVIDER');
    expect(presentRecordStatus(rec({ status: 'DELIVERED' }))).toBe('SIMULATED • ACCEPTED'); // simulator ≠ evidence
    expect(presentRecordStatus(rec({ status: 'FAILED' }))).toBe('SIMULATED • FAILED');
    expect(presentRecordStatus(rec({ status: 'UNCERTAIN', isSimulated: false }))).toBe(
      'NO PROVIDER RESPONSE • MAY NOT HAVE BEEN SENT'
    );
    expect(presentRecordStatus(rec({ status: 'QUEUED' }))).toBe('SIMULATED • SENDING…');
    expect(presentRecordStatus(rec({ status: 'NOT_SENT', reasonCode: 'emergency_already_resolved' }))).toBe(
      'NOT SENT • EMERGENCY RESOLVED'
    );
    expect(presentRecordStatus(rec({ status: 'NOT_SENT', reasonCode: 'dispatch_cancelled_emergency_resolved' }))).toBe(
      'NOT SENT • DISPATCH CANCELLED (RESOLVED)'
    );
    expect(presentRecordStatus(rec({ status: 'NOT_SENT', reasonCode: 'channel_not_available' }))).toBe(
      'NOT SENT • CHANNEL NOT AVAILABLE'
    );
  });

  test('card states before any record exists', () => {
    expect(presentContactAlerts({ ...base, signedIn: false, records: null }).status).toMatch(/sign in to alert/);
    expect(presentContactAlerts({ ...base, eventSyncStatus: SyncStatus.PENDING, records: null }).status).toMatch(
      /once this emergency reaches the server/
    );
    expect(presentContactAlerts({ ...base, eventSyncStatus: SyncStatus.LOCAL_ONLY, records: null }).badge.text).toBe('Not sent');
    expect(presentContactAlerts({ ...base, records: null }).status).toBe('Checking alert status…');
    expect(presentContactAlerts({ ...base, records: [], activeContactCount: 0 }).status).toMatch(/no active trusted contacts/);
    expect(presentContactAlerts({ ...base, records: [], activeContactCount: 2 }).status).toBe('Preparing alerts…');
  });

  test('card with records: per-contact lines, honest badge, never "Notification sent"', () => {
    const accepted = presentContactAlerts({
      ...base,
      records: [rec({ contactName: 'Mom' }), rec({ id: 'l2', contactName: 'Sister', status: 'FAILED' })],
    });
    expect(accepted.lines).toEqual(['Mom: SIMULATED • ACCEPTED', 'Sister: SIMULATED • FAILED']);
    expect(accepted.badge).toEqual({ text: 'Simulated', tone: 'neutral' });

    const sending = presentContactAlerts({ ...base, records: [rec({ status: 'DISPATCHED' })] });
    expect(sending.badge.text).toBe('Sending');

    const real = presentContactAlerts({ ...base, records: [rec({ isSimulated: false })] });
    expect(real.badge).toEqual({ text: 'Accepted', tone: 'active' });

    for (const out of [accepted, sending, real]) {
      expect(out.status).not.toMatch(/notification sent|delivered|read/i);
    }
  });

  test('parses server records (snake_case)', () => {
    expect(parseCommunicationLogs([fakeCommunicationLog({ contact_name: 'Mom', status: 'NOT_SENT', reason_code: 'x' })])).toEqual([
      expect.objectContaining({ contactName: 'Mom', status: 'NOT_SENT', reasonCode: 'x', isSimulated: true }),
    ]);
    expect(parseCommunicationLogs([{ id: 'x', status: 'SENT_TO_MARS' }])).toBeNull();
    expect(parseCommunicationLogs({})).toBeNull();
  });
});

describe('CommunicationStatusService: read-only, bounded polling', () => {
  beforeEach(() => resetIdentityForTesting());

  const setup = async () => {
    const stack = buildStack();
    await stack.auth.register('9000000002', 'secret123');
    const owner = getEventOwner();
    const event = await stack.coordinator.triggerEmergency(owner.userId, owner.deviceId, EmergencyTriggerSource.MANUAL_SOS);
    await stack.sync.flush();
    return { stack, eventId: event.eventId };
  };

  test('polls until every record is final, then stops', async () => {
    const { stack, eventId } = await setup();
    stack.backend.communicationLogs.set(eventId, [fakeCommunicationLog({ event_id: eventId, status: 'DISPATCHED' })]);
    const service = new CommunicationStatusService(stack.api, { intervalMs: 20, maxDurationMs: 5_000 });
    const updates: string[] = [];
    service.watch(eventId, (s) => updates.push(s.records?.[0]?.status ?? 'none'));
    await settle(60);
    stack.backend.communicationLogs.set(eventId, [fakeCommunicationLog({ event_id: eventId, status: 'PROVIDER_ACCEPTED' })]);
    await settle(80);
    const calls = stack.backend.calls.filter((c) => c.path.startsWith('/emergency/communication/logs/')).length;
    await settle(100);
    expect(stack.backend.calls.filter((c) => c.path.startsWith('/emergency/communication/logs/')).length).toBe(calls);
    expect(updates[0]).toBe('DISPATCHED');
    expect(updates[updates.length - 1]).toBe('PROVIDER_ACCEPTED');
    stack.sync.dispose();
  });

  test('no records + no active contacts → asks contacts once, then stops', async () => {
    const { stack, eventId } = await setup();
    const service = new CommunicationStatusService(stack.api, { intervalMs: 20, maxDurationMs: 5_000 });
    let last: { activeContactCount: number | null } | null = null;
    service.watch(eventId, (s) => (last = s));
    await settle(100);
    expect(last).toMatchObject({ activeContactCount: 0 });
    expect(stack.backend.calls.filter((c) => c.path === '/contacts')).toHaveLength(1);
    const logCalls = stack.backend.calls.filter((c) => c.path.startsWith('/emergency/communication/logs/')).length;
    expect(logCalls).toBe(1);
    stack.sync.dispose();
  });

  test('stops at the time limit and when unwatched', async () => {
    const { stack, eventId } = await setup();
    stack.backend.communicationLogs.set(eventId, [fakeCommunicationLog({ event_id: eventId, status: 'QUEUED' })]);
    const service = new CommunicationStatusService(stack.api, { intervalMs: 10, maxDurationMs: 60 });
    service.watch(eventId, () => undefined);
    await settle(150);
    const afterLimit = stack.backend.calls.length;
    await settle(80);
    expect(stack.backend.calls.length).toBe(afterLimit);

    const service2 = new CommunicationStatusService(stack.api, { intervalMs: 10, maxDurationMs: 10_000 });
    const stop = service2.watch(eventId, () => undefined);
    await settle(30);
    stop();
    const afterStop = stack.backend.calls.length;
    await settle(80);
    expect(stack.backend.calls.length).toBe(afterStop);
    stack.sync.dispose();
  });
});
