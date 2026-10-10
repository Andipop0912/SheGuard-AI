import { resetIdentityForTesting, getEventOwner, UNCLAIMED_USER_ID } from '../../src/app/identity';
import { AuthState } from '../../src/auth/domain/AuthState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyStorageRepository, LEGACY_LOCAL_ONLY_REASON } from '../../src/storage/EmergencyStorageRepository';
import { presentEventSync } from '../../src/sync/syncPresentation';
import { Stack, buildStack, settle } from '../net/fakes';

/** Phase 3C offline/sync scenarios A–K against the fake backend. */
describe('EmergencySyncService', () => {
  let stack: Stack;

  beforeEach(() => {
    resetIdentityForTesting();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    stack = buildStack();
  });

  afterEach(() => {
    stack.sync.dispose();
    jest.restoreAllMocks();
  });

  const trigger = (source = EmergencyTriggerSource.MANUAL_SOS) => {
    const owner = getEventOwner();
    return stack.coordinator.triggerEmergency(owner.userId, owner.deviceId, source);
  };
  const stored = async (eventId: string) => (await stack.repository.getEvent(eventId))!;
  const signIn = async () => {
    await stack.auth.restore();
    const res = await stack.auth.register('9876543210', 'secret123');
    expect(res.ok).toBe(true);
  };

  test('A. signed out: SOS + resolve are local; no requests, no timers; shown as "sign in to back it up"', async () => {
    await stack.auth.restore();
    stack.sync.start();
    const event = await trigger();
    await stack.coordinator.resolveEmergency(event.eventId);
    await settle();
    await stack.sync.flush();

    expect(stack.backend.calls).toHaveLength(0);
    const saved = await stored(event.eventId);
    expect(saved.state).toBe(EmergencyState.RESOLVED);
    expect(saved.syncStatus).toBe(SyncStatus.PENDING);
    expect(saved.userId).toBe(UNCLAIMED_USER_ID);
    expect(stack.sync.getSnapshot().activity.kind).toBe('SIGNED_OUT');
    expect(presentEventSync(saved, null, stack.sync.getSnapshot()).status).toMatch(/sign in to back it up/);
  });

  test('B. signed in + online: event is uploaded automatically and marked SYNCED only after confirmation', async () => {
    await signIn();
    stack.sync.start();
    const event = await trigger();
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING); // nothing synchronous

    await settle(20);
    await stack.sync.flush();
    const saved = await stored(event.eventId);
    expect(saved.syncStatus).toBe(SyncStatus.SYNCED);
    expect(saved.syncedAt).toEqual(expect.any(Number));
    expect(stack.backend.events.get(event.eventId)?.state).toBe(EmergencyState.RESPONDING);

    // Resolve → PENDING → UPDATED on the server → SYNCED again.
    await stack.coordinator.resolveEmergency(event.eventId);
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING);
    await settle(20);
    await stack.sync.flush();
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.SYNCED);
    expect(stack.backend.events.get(event.eventId)?.state).toBe(EmergencyState.RESOLVED);
  });

  test('C/D. offline or server down: stays PENDING, bounded backoff, then syncs when reachable', async () => {
    await signIn();
    stack.backend.offline = true;
    const event = await trigger();
    await stack.sync.flush();

    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING);
    const activity = stack.sync.getSnapshot().activity;
    expect(activity.kind).toBe('RETRY_SCHEDULED');

    // Server error (5xx) is also retryable.
    stack.backend.offline = false;
    stack.backend.forced.push({ path: '/emergencies/sync', status: 503 });
    await stack.sync.flush();
    expect(stack.sync.getSnapshot().activity.kind).toBe('RETRY_SCHEDULED');
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING);

    // The scheduled retry (40 ms → 80 ms in this test policy) uploads it without any manual call.
    await settle(200);
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.SYNCED);
    expect(stack.sync.getSnapshot().activity.kind).toBe('IDLE');
  });

  test('backoff is capped and stops when nothing is pending', async () => {
    await signIn();
    stack.backend.offline = true;
    await trigger();
    for (let i = 0; i < 5; i++) await stack.sync.flush();
    const activity = stack.sync.getSnapshot().activity;
    expect(activity.kind === 'RETRY_SCHEDULED' && activity.retryInMs).toBeLessThanOrEqual(160);

    stack.backend.offline = false;
    await stack.sync.flush();
    expect(stack.sync.getSnapshot().activity.kind).toBe('IDLE');
    const callsAfter = stack.backend.calls.length;
    await settle(250);
    expect(stack.backend.calls.length).toBe(callsAfter); // no polling once idle
  });

  test('E/F. expired access token: refresh once, retry, synced', async () => {
    await signIn();
    stack.backend.expireAccessTokens();
    const event = await trigger();
    await stack.sync.flush();
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.SYNCED);
    expect(stack.backend.callsTo('/auth/refresh')).toHaveLength(1);
  });

  test('G. refresh fails: signed out, event stays PENDING locally, no retry timer', async () => {
    await signIn();
    stack.backend.expireAccessTokens();
    stack.backend.revokeAllRefreshTokens();
    const event = await trigger();
    await stack.sync.flush();

    expect(stack.auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING);
    expect(stack.sync.getSnapshot().activity.kind).toBe('SIGNED_OUT');
    const calls = stack.backend.calls.length;
    await settle(200);
    expect(stack.backend.calls.length).toBe(calls);
  });

  test('H. app restarted with a pending emergency: uploaded after restore (nothing stuck in "syncing")', async () => {
    await signIn();
    stack.backend.offline = true;
    const event = await trigger();
    await stack.sync.flush();
    stack.sync.dispose();

    // New JS runtime over the same storage and secure store.
    resetIdentityForTesting();
    stack.backend.offline = false;
    const restarted = buildStack({ backend: stack.backend, secureStore: stack.secureStore });
    await restarted.coordinator.restoreActiveEvent();
    await restarted.auth.restore();
    expect((await restarted.repository.getEvent(event.eventId))?.syncStatus).toBe(SyncStatus.PENDING);
    await restarted.sync.flush();
    expect((await restarted.repository.getEvent(event.eventId))?.syncStatus).toBe(SyncStatus.SYNCED);
    restarted.sync.dispose();
  });

  test('I. same emergency synced twice: one server record; ALREADY_SYNCED counts as synced', async () => {
    await signIn();
    const event = await trigger();
    await stack.sync.flush();
    // Force a re-send of the same version.
    await stack.repository.applySyncOutcome(event.eventId, event.updatedAt, { syncStatus: SyncStatus.PENDING });
    await stack.sync.flush();
    expect(stack.backend.events.size).toBe(1);
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.SYNCED);
  });

  test('concurrent flushes never send the same event twice at once', async () => {
    await signIn();
    await trigger();
    await Promise.all([stack.sync.flush(), stack.sync.flush(), stack.sync.flush()]);
    expect(stack.backend.callsTo('/emergencies/sync').length).toBeLessThanOrEqual(2);
    expect(stack.backend.events.size).toBe(1);
  });

  test('J. multiple pending emergencies upload in one batch with per-event results', async () => {
    await signIn();
    stack.backend.offline = true;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await trigger();
      ids.push(e.eventId);
      await stack.coordinator.resolveEmergency(e.eventId);
    }
    stack.backend.offline = false;
    const before = stack.backend.callsTo('/emergencies/sync').length;
    await stack.sync.flush();
    expect(stack.backend.callsTo('/emergencies/sync').length - before).toBe(1);
    for (const id of ids) expect((await stored(id)).syncStatus).toBe(SyncStatus.SYNCED);
  });

  test('K. logout with pending emergencies: kept locally; uploaded by the next sign-in on this phone (claim)', async () => {
    await signIn();
    const userId = stack.auth.getSession()!.userId;
    stack.backend.offline = true;
    const before = await trigger();
    await stack.coordinator.resolveEmergency(before.eventId);
    await stack.auth.logout();
    stack.backend.offline = false;

    // SOS while signed out.
    const signedOutEvent = await trigger();
    expect(signedOutEvent.userId).toBe(UNCLAIMED_USER_ID);
    await stack.sync.flush();
    expect(stack.backend.callsTo('/emergencies/sync')).toHaveLength(0);

    await stack.auth.login('9876543210', 'secret123');
    await stack.sync.flush();
    for (const id of [before.eventId, signedOutEvent.eventId]) {
      const saved = await stored(id);
      expect(saved.syncStatus).toBe(SyncStatus.SYNCED);
      expect(saved.userId).toBe(userId); // claimed
    }
  });

  test('events of a different account are never uploaded under the signed-in account', async () => {
    await signIn();
    const event = await trigger();
    await stack.sync.flush();
    await stack.coordinator.resolveEmergency(event.eventId); // PENDING, owned by account 1
    await stack.auth.logout();

    await stack.auth.register('9123456780', 'other-pass');
    await stack.sync.flush();
    const saved = await stored(event.eventId);
    expect(saved.syncStatus).toBe(SyncStatus.PENDING);
    expect(presentEventSync(saved, stack.auth.getSession(), stack.sync.getSnapshot()).status).toMatch(/another account/);
    expect(stack.backend.events.get(event.eventId)?.state).toBe(EmergencyState.RESPONDING);
  });

  test('compare-and-set: resolved during an in-flight upload → stays PENDING, newer version uploaded next', async () => {
    await signIn();
    const event = await trigger();
    const originalFetch = stack.backend.fetch;
    let resolvedDuringUpload = false;
    (stack.http as unknown as { fetchFn: typeof originalFetch }).fetchFn = async (input, init) => {
      if (!resolvedDuringUpload && String(input).endsWith('/emergencies/sync')) {
        resolvedDuringUpload = true;
        await stack.coordinator.resolveEmergency(event.eventId);
      }
      return originalFetch(input, init);
    };
    await stack.sync.flush();
    // First upload confirmed the OLD version; the new one was then uploaded by the rerun.
    expect(stack.backend.events.get(event.eventId)?.state).toBe(EmergencyState.RESOLVED);
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.SYNCED);
  });

  // Regression (2026-10-07): updatedAt is the event version. Changes in the same clock tick used to get
  // the same version, so an older in-flight upload could "confirm" a newer state (phone RESOLVED +
  // SYNCED while the server held RESPONDING).
  test('REGRESSION: same-millisecond lifecycle changes — an older upload can never confirm the newer state', async () => {
    await signIn();
    const FROZEN = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(FROZEN); // every lifecycle change below happens in ONE millisecond

    const event = await trigger();
    const created = (await stored(event.eventId)).createdAt;
    expect(created).toBe(FROZEN);
    expect(event.updatedAt).toBeGreaterThan(created); // TRIGGERED → RESPONDING in the same ms: new version

    // Record every sync outcome the service tries to apply, and the server state at that moment.
    const applied: { sentUpdatedAt: number; status: string | undefined; accepted: boolean; serverState: string | undefined }[] = [];
    const realApply = stack.repository.applySyncOutcome.bind(stack.repository);
    jest.spyOn(stack.repository, 'applySyncOutcome').mockImplementation(async (id, sentUpdatedAt, patch) => {
      const result = await realApply(id, sentUpdatedAt, patch);
      applied.push({ sentUpdatedAt, status: patch.syncStatus, accepted: result !== null, serverState: stack.backend.events.get(id)?.state });
      return result;
    });

    // Resolve while the RESPONDING version is in flight (still the same millisecond).
    const originalFetch = stack.backend.fetch;
    let resolvedVersion = 0;
    (stack.http as unknown as { fetchFn: typeof originalFetch }).fetchFn = async (input, init) => {
      if (!resolvedVersion && String(input).endsWith('/emergencies/sync')) {
        resolvedVersion = (await stack.coordinator.resolveEmergency(event.eventId))!.updatedAt;
      }
      return originalFetch(input, init);
    };

    await stack.sync.flush();

    // Two lifecycle changes in the same millisecond received different versions.
    expect(resolvedVersion).toBeGreaterThan(event.updatedAt);

    // The older (RESPONDING) upload was confirmed by the server but could NOT mark the newer local state.
    const sent = stack.backend.callsTo('/emergencies/sync').map((c) => c.body.events[0].state);
    expect(sent).toEqual(['RESPONDING', 'RESOLVED']);
    expect(applied[0]).toMatchObject({ sentUpdatedAt: event.updatedAt, status: SyncStatus.SYNCED, accepted: false });

    // The newer state was then uploaded, and SYNCED was applied only when the server already held RESOLVED.
    const acceptedSynced = applied.filter((a) => a.accepted && a.status === SyncStatus.SYNCED);
    expect(acceptedSynced).toHaveLength(1);
    expect(acceptedSynced[0]).toMatchObject({ sentUpdatedAt: resolvedVersion, serverState: EmergencyState.RESOLVED });

    // PHONE STATE == SERVER STATE == RESOLVED, and only then SYNCED.
    const phone = await stored(event.eventId);
    expect(phone.state).toBe(EmergencyState.RESOLVED);
    expect(stack.backend.events.get(event.eventId)?.state).toBe(EmergencyState.RESOLVED);
    expect(stack.backend.events.get(event.eventId)?.updatedAt).toBe(phone.updatedAt);
    expect(phone.syncStatus).toBe(SyncStatus.SYNCED);
  });

  test('REGRESSION: every lifecycle change gets a strictly greater version even with a frozen clock (resolve and cancel)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const first = await trigger();
    const resolved = (await stack.coordinator.resolveEmergency(first.eventId))!;
    expect(resolved.updatedAt).toBeGreaterThan(first.updatedAt);

    const second = await trigger();
    const cancelled = (await stack.coordinator.cancelEmergency(second.eventId))!;
    expect(second.updatedAt).toBeGreaterThan(second.createdAt);
    expect(cancelled.updatedAt).toBeGreaterThan(second.updatedAt);
    expect(cancelled.state).toBe(EmergencyState.CANCELLED);
  });

  test('sync bookkeeping never changes lifecycle timestamps', async () => {
    await signIn();
    const event = await trigger();
    const before = await stored(event.eventId);
    await stack.sync.flush();
    const after = await stored(event.eventId);
    expect(after.syncStatus).toBe(SyncStatus.SYNCED);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.createdAt).toBe(before.createdAt);
  });

  test('server rejects an item → FAILED with reason, not retried automatically', async () => {
    await signIn();
    const event = await trigger();
    // Make the server see a mismatched owner by tampering with the event (simulates a rejected item).
    const otherOwner = { ...(await stored(event.eventId)) };
    stack.backend.events.set(event.eventId, {
      eventId: event.eventId,
      userId: 'someone-else',
      deviceId: 'x',
      state: 'RESPONDING',
      triggerSource: 'MANUAL_SOS',
      createdAt: otherOwner.createdAt,
      updatedAt: otherOwner.updatedAt,
      resolvedAt: null,
    });
    await stack.sync.flush();
    const saved = await stored(event.eventId);
    expect(saved.syncStatus).toBe(SyncStatus.FAILED);
    expect(saved.syncError).toMatch(/not found/);
    const calls = stack.backend.calls.length;
    await stack.sync.flush();
    expect(stack.backend.calls.length).toBe(calls);
  });

  test('422 for a batch → FAILED (no infinite retry of an unacceptable request)', async () => {
    await signIn();
    const event = await trigger();
    stack.backend.forced.push({ path: '/emergencies/sync', status: 422, detail: 'bad shape' });
    await stack.sync.flush();
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.FAILED);
  });

  test('not configured → no requests, truthful state', async () => {
    const { HttpClient } = jest.requireActual('../../src/api/HttpClient');
    const { ApiClient } = jest.requireActual('../../src/api/ApiClient');
    const { EmergencySyncService } = jest.requireActual('../../src/sync/EmergencySyncService');
    await signIn();
    const api = new ApiClient(new HttpClient(() => null, 1000, stack.backend.fetch), stack.auth);
    const sync = new EmergencySyncService(stack.repository, stack.coordinator, api, stack.auth);
    const event = await trigger();
    const before = stack.backend.calls.length;
    await sync.flush();
    expect(stack.backend.calls.length).toBe(before);
    expect(sync.getSnapshot().activity.kind).toBe('NOT_CONFIGURED');
    expect((await stored(event.eventId)).syncStatus).toBe(SyncStatus.PENDING);
    sync.dispose();
  });
});

describe('D5: legacy events from before real sync', () => {
  test('one-time migration marks existing events LOCAL_ONLY; new events are PENDING; never uploaded', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const legacy = {
      eventId: 'evt-legacy-1',
      userId: 'user-sheguard-01',
      deviceId: 'dev-android-01',
      triggerSource: 'VOICE',
      state: 'RESOLVED',
      createdAt: 1000,
      updatedAt: 2000,
      resolvedAt: 1990,
      syncStatus: 'SYNCED', // falsely marked by the old simulated sync
    };
    await AsyncStorage.setItem('@sheguard_emergency_events_v1', JSON.stringify([legacy]));

    resetIdentityForTesting();
    const stack = buildStack({ repository: new EmergencyStorageRepository() });
    const migrated = await stack.repository.getEvent('evt-legacy-1');
    expect(migrated).toMatchObject({ syncStatus: SyncStatus.LOCAL_ONLY, syncError: LEGACY_LOCAL_ONLY_REASON, updatedAt: 2000 });

    await stack.auth.register('9876543210', 'secret123');
    await stack.sync.flush();
    expect(stack.backend.events.has('evt-legacy-1')).toBe(false);

    // Migration runs once: a later load keeps the statuses as they are.
    const reloaded = new EmergencyStorageRepository();
    expect((await reloaded.getEvent('evt-legacy-1'))?.syncStatus).toBe(SyncStatus.LOCAL_ONLY);
    const fresh = await stack.coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    expect(fresh.syncStatus).toBe(SyncStatus.PENDING);
    stack.sync.dispose();
  });
});
