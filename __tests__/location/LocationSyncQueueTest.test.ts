import {
  EmergencyLocationPoint,
  EmergencyLocationRepository,
  LocationPointKind,
  LocationSyncStatus,
} from '../../src/location/storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../../src/location/sync/LocationSyncQueue';
import {
  HttpLocationSyncTransport,
  LocationSyncResult,
  LocationSyncTransport,
} from '../../src/location/sync/LocationSyncTransport';
import { fix, NOW, testPolicy } from './fakes';

class ScriptedTransport implements LocationSyncTransport {
  public calls: { eventId: string; ids: string[] }[] = [];
  constructor(private readonly script: ((points: EmergencyLocationPoint[]) => LocationSyncResult)[]) {}

  public async send(eventId: string, points: EmergencyLocationPoint[]): Promise<LocationSyncResult> {
    this.calls.push({ eventId, ids: points.map((p) => p.locationId) });
    const step = this.script.length > 1 ? this.script.shift()! : this.script[0];
    return step(points);
  }
}

const allSynced = (points: EmergencyLocationPoint[]): LocationSyncResult => ({
  kind: 'RESULTS',
  results: points.map((p) => ({ locationId: p.locationId, status: 'SYNCED', message: null })),
});

async function seed(repository: EmergencyLocationRepository, eventId = 'evt-1', count = 2) {
  for (let i = 0; i < count; i++) {
    await repository.addPoint(eventId, i === 0 ? LocationPointKind.SNAPSHOT : LocationPointKind.UPDATE,
      fix({ timestamp: NOW - 10_000 + i }));
  }
}

describe('LocationSyncQueue', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('successful sync marks points SYNCED and keeps them locally', async () => {
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const queue = new LocationSyncQueue(repository, new ScriptedTransport([allSynced]), testPolicy);

    await queue.flush();

    const points = await repository.getPoints('evt-1');
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.syncStatus === LocationSyncStatus.SYNCED)).toBe(true);
    expect(queue.getState()).toEqual({ kind: 'IDLE', pending: 0 });
  });

  test('a not-yet-synced event earlier in the batch never blocks already-synced events behind it', async () => {
    // Device-observed: evt-not-synced (created moments ago, still PENDING server-side) sits
    // first in the batch; evt-synced's points must still upload in the same pass instead of
    // being starved behind it.
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository, 'evt-not-synced', 2);
    await seed(repository, 'evt-synced', 2);

    const calls: string[] = [];
    const transport: LocationSyncTransport = {
      send: async (eventId, points) => {
        calls.push(eventId);
        if (eventId === 'evt-not-synced') return { kind: 'EVENT_NOT_SYNCED' };
        return { kind: 'RESULTS', results: points.map((p) => ({ locationId: p.locationId, status: 'SYNCED', message: null })) };
      },
    };
    const queue = new LocationSyncQueue(repository, transport, testPolicy);

    await queue.flush();

    expect(calls).toEqual(['evt-not-synced', 'evt-synced']); // both attempted, not just the first
    const syncedPoints = await repository.getPoints('evt-synced');
    expect(syncedPoints.every((p) => p.syncStatus === LocationSyncStatus.SYNCED)).toBe(true);
    const notSyncedPoints = await repository.getPoints('evt-not-synced');
    expect(notSyncedPoints.every((p) => p.syncStatus === LocationSyncStatus.PENDING)).toBe(true);
  });

  test('16. backend failure does not destroy local location; points stay PENDING', async () => {
    jest.useFakeTimers();
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const queue = new LocationSyncQueue(
      repository,
      new ScriptedTransport([() => ({ kind: 'RETRYABLE_ERROR', message: 'HTTP 503' })]),
      testPolicy
    );

    await queue.flush();

    const points = await repository.getPoints('evt-1');
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.syncStatus === LocationSyncStatus.PENDING)).toBe(true);
    expect(points[0].lastSyncError).toBe('HTTP 503');
    expect(queue.getState().kind).toBe('RETRY_SCHEDULED');
    queue.dispose();
  });

  test('17. retryable failure is retried with backoff and then succeeds', async () => {
    jest.useFakeTimers();
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const transport = new ScriptedTransport([
      () => ({ kind: 'RETRYABLE_ERROR', message: 'offline' }),
      () => ({ kind: 'EVENT_NOT_SYNCED' }),
      allSynced,
    ]);
    const queue = new LocationSyncQueue(repository, transport, testPolicy);

    await queue.flush();
    expect(transport.calls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(testPolicy.syncRetryInitialMs); // 1st retry → EVENT_NOT_SYNCED
    expect(transport.calls).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(testPolicy.syncRetryInitialMs * 2); // backoff doubled → success
    expect(transport.calls).toHaveLength(3);

    const points = await repository.getPoints('evt-1');
    expect(points.every((p) => p.syncStatus === LocationSyncStatus.SYNCED)).toBe(true);
    expect(queue.getState().kind).toBe('IDLE');
  });

  test('not connected: nothing is faked, nothing spins; a later transport delivers', async () => {
    jest.useFakeTimers();
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const disconnected = new ScriptedTransport([() => ({ kind: 'NOT_CONNECTED' })]);
    const queue = new LocationSyncQueue(repository, disconnected, testPolicy);

    await queue.flush();
    await jest.advanceTimersByTimeAsync(10 * testPolicy.syncRetryMaxMs);
    expect(disconnected.calls).toHaveLength(1); // no timer-driven retries while disconnected
    expect(queue.getState()).toEqual({ kind: 'NOT_CONNECTED', pending: 2 });

    await queue.setTransport(new ScriptedTransport([allSynced]));
    expect(await repository.countPending()).toBe(0);
  });

  test('server-rejected points are kept locally as REJECTED, others SYNCED', async () => {
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const queue = new LocationSyncQueue(
      repository,
      new ScriptedTransport([
        (points) => ({
          kind: 'RESULTS',
          results: [
            { locationId: points[0].locationId, status: 'SYNCED', message: null },
            { locationId: points[1].locationId, status: 'FAILED', message: 'Location limit for this emergency reached.' },
          ],
        }),
      ]),
      testPolicy
    );

    await queue.flush();

    const [first, second] = await repository.getPoints('evt-1');
    expect(first.syncStatus).toBe(LocationSyncStatus.SYNCED);
    expect(second.syncStatus).toBe(LocationSyncStatus.REJECTED);
    expect(second.lastSyncError).toContain('limit');
  });

  test('concurrent flushes share one worker (no duplicate uploads)', async () => {
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository);
    const transport = new ScriptedTransport([allSynced]);
    const queue = new LocationSyncQueue(repository, transport, testPolicy);

    await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
    expect(transport.calls).toHaveLength(1);
  });

  test('local cap per emergency is enforced', async () => {
    const repository = new EmergencyLocationRepository(3, () => NOW);
    await seed(repository, 'evt-cap', 5);
    expect(await repository.getPoints('evt-cap')).toHaveLength(3);
  });

  test('HTTP transport sends the backend contract and maps statuses', async () => {
    const repository = new EmergencyLocationRepository(2000, () => NOW);
    await seed(repository, 'evt-http', 1);
    const [point] = await repository.getPoints('evt-http');
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ locationId: point.locationId, status: 'SYNCED' }] }),
    });
    const transport = new HttpLocationSyncTransport(
      'https://api.example/api/v1',
      { getAccessToken: async () => 'token-1' },
      5_000,
      fetchFn
    );

    const result = await transport.send('evt-http', [point]);

    expect(result).toEqual({ kind: 'RESULTS', results: [{ locationId: point.locationId, status: 'SYNCED', message: null }] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example/api/v1/emergencies/evt-http/locations/sync');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    const body = JSON.parse(init.body);
    expect(body.points[0]).toMatchObject({
      locationId: point.locationId, kind: 'SNAPSHOT', latitude: 19.076, longitude: 72.8777, capturedAt: point.fix.timestamp,
    });

    const unauthenticated = new HttpLocationSyncTransport('x', { getAccessToken: async () => null }, 5_000, fetchFn);
    expect(await unauthenticated.send('evt-http', [point])).toEqual({ kind: 'NOT_CONNECTED' });
  });
});
