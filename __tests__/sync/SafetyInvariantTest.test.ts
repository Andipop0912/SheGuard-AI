import { getEventOwner, resetIdentityForTesting } from '../../src/app/identity';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState, isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyLocationPoint, LocationPointKind, LocationSyncStatus } from '../../src/location/storage/EmergencyLocationRepository';
import { SessionLocationSyncTransport } from '../../src/sync/SessionLocationSyncTransport';
import { LocationSyncTransport } from '../../src/location/sync/LocationSyncTransport';
import { LocationProvider } from '../../src/location/domain/LocationFix';
import { Stack, buildStack, settle } from '../net/fakes';

/**
 * NON-NEGOTIABLE: triggerEmergency() must never depend on network, backend or authentication.
 */
describe('Safety invariant: SOS is local-first', () => {
  let stack: Stack;

  beforeEach(() => {
    resetIdentityForTesting();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    stack?.sync.dispose();
    jest.restoreAllMocks();
  });

  const triggerAndObserve = async () => {
    const seen: string[] = [];
    stack.coordinator.subscribeActiveEvent((e) => {
      if (e) seen.push(e.eventId);
    });
    const callsBefore = stack.backend.calls.length;
    const owner = getEventOwner();
    const event = await stack.coordinator.triggerEmergency(owner.userId, owner.deviceId, EmergencyTriggerSource.MANUAL_SOS);
    // The UI listener has the event and it is persisted before ANY network request was made.
    expect(seen).toContain(event.eventId);
    expect(stack.backend.calls.length).toBe(callsBefore);
    const saved = await stack.repository.getEvent(event.eventId);
    expect(saved && isOpenEmergencyState(saved.state)).toBe(true);
    return event;
  };

  test('server that never responds (hung network) cannot delay the trigger', async () => {
    stack = buildStack({ timeoutMs: 60_000 });
    await stack.auth.register('9876543210', 'secret123');
    stack.backend.hang = true;
    stack.sync.start();

    const started = Date.now();
    const event = await triggerAndObserve();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(event.state).toBe(EmergencyState.RESPONDING);
    await settle(10); // the upload is now in flight in the background — and hanging
    expect(stack.backend.callsTo('/emergencies/sync').length).toBeGreaterThanOrEqual(1);

    // Resolve also completes locally while the upload hangs.
    const resolved = await stack.coordinator.resolveEmergency(event.eventId);
    expect(resolved?.state).toBe(EmergencyState.RESOLVED);
  });

  test('signed out: trigger and resolve work and make no requests', async () => {
    stack = buildStack();
    await stack.auth.restore();
    stack.sync.start();
    const event = await triggerAndObserve();
    await stack.coordinator.resolveEmergency(event.eventId);
    await settle(10);
    expect(stack.backend.calls).toHaveLength(0);
  });

  test('offline + failing secure storage: SOS still works', async () => {
    stack = buildStack();
    stack.secureStore.failReads = true;
    stack.backend.offline = true;
    await stack.auth.restore();
    stack.sync.start();
    const event = await triggerAndObserve();
    expect((await stack.repository.getEvent(event.eventId))?.syncStatus).toBe(SyncStatus.PENDING);
  });

  test('sync code throwing does not reach the trigger', async () => {
    stack = buildStack();
    await stack.auth.register('9876543210', 'secret123');
    jest.spyOn(stack.api, 'authorizedRequest').mockImplementation(() => {
      throw new Error('boom');
    });
    stack.sync.start();
    const event = await triggerAndObserve();
    await settle(10);
    expect((await stack.repository.getEvent(event.eventId))?.state).toBe(EmergencyState.RESPONDING);
    expect(stack.sync.getSnapshot().activity.kind).toBe('RETRY_SCHEDULED');
  });

  test('the coordinator does not import any network/auth/sync code', () => {
    const fs = require('fs');
    const path = require('path');
    const source: string = fs.readFileSync(
      path.join(__dirname, '../../src/emergency/services/EmergencyCoordinator.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/from '\.\.\/\.\.\/(api|auth|sync|contacts|communication)\//);
    expect(source).not.toMatch(/fetch\(/);
  });
});

describe('Location uploads follow the emergency sync state', () => {
  const point = (eventId: string): EmergencyLocationPoint => ({
    locationId: `loc-${eventId}`,
    eventId,
    kind: LocationPointKind.SNAPSHOT,
    fix: {
      latitude: 1,
      longitude: 2,
      accuracyMeters: 5,
      altitudeMeters: null,
      speedMps: null,
      headingDegrees: null,
      timestamp: Date.now(),
      provider: LocationProvider.FUSED,
      isLastKnown: false,
    },
    recordedAt: Date.now(),
    syncStatus: LocationSyncStatus.PENDING,
    syncAttempts: 0,
    lastSyncError: null,
  });

  test('pending → not sent; synced → sent; local-only/failed → rejected (not retried forever)', async () => {
    resetIdentityForTesting();
    const stack = buildStack();
    const http: LocationSyncTransport = { send: jest.fn(async () => ({ kind: 'RESULTS' as const, results: [] })) };
    const transport = new SessionLocationSyncTransport(stack.repository, http);

    const event = await stack.coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    expect(await transport.send(event.eventId, [point(event.eventId)])).toEqual({ kind: 'EVENT_NOT_SYNCED' });
    expect(http.send).not.toHaveBeenCalled();

    await stack.repository.applySyncOutcome(event.eventId, event.updatedAt, { syncStatus: SyncStatus.SYNCED });
    await transport.send(event.eventId, [point(event.eventId)]);
    expect(http.send).toHaveBeenCalledTimes(1);

    await stack.repository.applySyncOutcome(event.eventId, event.updatedAt, { syncStatus: SyncStatus.LOCAL_ONLY });
    const res = await transport.send(event.eventId, [point(event.eventId)]);
    expect(res.kind === 'RESULTS' && res.results[0].status).toBe('FAILED');
    expect(http.send).toHaveBeenCalledTimes(1);
    stack.sync.dispose();
  });
});
