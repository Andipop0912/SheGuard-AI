import { EvidenceItem, EvidenceSyncStatus, EvidenceType } from '../../src/evidence/domain/EvidenceItem';
import { EvidenceRepository } from '../../src/evidence/storage/EvidenceRepository';
import { EvidenceSyncQueue } from '../../src/evidence/sync/EvidenceSyncQueue';
import { EvidenceUploadResult, EvidenceUploadTransport, HttpEvidenceUploadTransport } from '../../src/evidence/sync/EvidenceUploadTransport';

class ScriptedTransport implements EvidenceUploadTransport {
  public calls: string[] = [];
  constructor(private readonly script: ((item: EvidenceItem) => EvidenceUploadResult)[]) {}

  public async upload(item: EvidenceItem): Promise<EvidenceUploadResult> {
    this.calls.push(item.evidenceId);
    const step = this.script.length > 1 ? this.script.shift()! : this.script[0];
    return step(item);
  }
}

function makeItem(evidenceId: string, eventId = 'evt-1'): EvidenceItem {
  return {
    evidenceId,
    eventId,
    type: EvidenceType.AUDIO,
    filePath: `/fake/${evidenceId}.m4a`,
    createdAt: Date.now(),
    durationMs: 1234,
    syncStatus: EvidenceSyncStatus.LOCAL_ONLY,
  };
}

describe('EvidenceSyncQueue', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('successful upload marks the item UPLOADED and keeps the local file record', async () => {
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-1'));
    const queue = new EvidenceSyncQueue(repository, new ScriptedTransport([() => ({ kind: 'SUCCESS' })]));

    await queue.flush();

    const items = await repository.getForEvent('evt-1');
    expect(items[0].syncStatus).toBe(EvidenceSyncStatus.UPLOADED);
    expect(queue.getState()).toEqual({ kind: 'IDLE', pending: 0 });
  });

  test('one item failing never blocks another item in the same flush', async () => {
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-fail'));
    await repository.save(makeItem('ev-ok'));
    const calls: string[] = [];
    const transport: EvidenceUploadTransport = {
      upload: async (item) => {
        calls.push(item.evidenceId);
        return item.evidenceId === 'ev-fail' ? { kind: 'RETRYABLE_ERROR', message: 'HTTP 503' } : { kind: 'SUCCESS' };
      },
    };
    const queue = new EvidenceSyncQueue(repository, transport);

    await queue.flush();

    expect(calls).toEqual(['ev-fail', 'ev-ok']); // both attempted
    const items = await repository.getForEvent('evt-1');
    expect(items.find((i) => i.evidenceId === 'ev-ok')?.syncStatus).toBe(EvidenceSyncStatus.UPLOADED);
    expect(items.find((i) => i.evidenceId === 'ev-fail')?.syncStatus).toBe(EvidenceSyncStatus.LOCAL_ONLY);
    expect(queue.getState().kind).toBe('RETRY_SCHEDULED');
  });

  test('a permanently rejected item (bad mime/too large) is marked FAILED, not retried forever', async () => {
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-bad'));
    const transport = new ScriptedTransport([() => ({ kind: 'REJECTED', message: 'HTTP 415' })]);
    const queue = new EvidenceSyncQueue(repository, transport);

    await queue.flush();

    const items = await repository.getForEvent('evt-1');
    expect(items[0].syncStatus).toBe(EvidenceSyncStatus.FAILED);
    expect(queue.getState()).toEqual({ kind: 'IDLE', pending: 0 }); // not pending retry
  });

  test('retryable failure is retried with backoff and then succeeds', async () => {
    jest.useFakeTimers();
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-retry'));
    const transport = new ScriptedTransport([
      () => ({ kind: 'RETRYABLE_ERROR', message: 'offline' }),
      () => ({ kind: 'SUCCESS' }),
    ]);
    const queue = new EvidenceSyncQueue(repository, transport);

    await queue.flush();
    expect(transport.calls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(transport.calls).toHaveLength(2);

    const items = await repository.getForEvent('evt-1');
    expect(items[0].syncStatus).toBe(EvidenceSyncStatus.UPLOADED);
    expect(queue.getState().kind).toBe('IDLE');
  });

  test('not connected: nothing is faked, nothing spins; a later transport delivers', async () => {
    jest.useFakeTimers();
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-disc'));
    const disconnected = new ScriptedTransport([() => ({ kind: 'NOT_CONNECTED' })]);
    const queue = new EvidenceSyncQueue(repository, disconnected);

    await queue.flush();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(disconnected.calls).toHaveLength(1); // no timer-driven retries while disconnected
    expect(queue.getState()).toEqual({ kind: 'NOT_CONNECTED', pending: 1 });

    await queue.setTransport(new ScriptedTransport([() => ({ kind: 'SUCCESS' })]));
    const items = await repository.getForEvent('evt-1');
    expect(items[0].syncStatus).toBe(EvidenceSyncStatus.UPLOADED);
  });

  test('concurrent flushes share one worker (no duplicate uploads)', async () => {
    const repository = new EvidenceRepository();
    await repository.save(makeItem('ev-dup'));
    const transport = new ScriptedTransport([() => ({ kind: 'SUCCESS' })]);
    const queue = new EvidenceSyncQueue(repository, transport);

    await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
    expect(transport.calls).toHaveLength(1);
  });

  test('HTTP transport sends a multipart request with the auth token and maps statuses', async () => {
    const item = makeItem('ev-http');
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    const transport = new HttpEvidenceUploadTransport('https://api.example/api/v1', { getAccessToken: async () => 'token-1' }, 5_000, fetchFn);

    const result = await transport.upload(item);

    expect(result).toEqual({ kind: 'SUCCESS' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example/api/v1/evidence/evt-1/items');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.body).toBeInstanceOf(FormData);

    const unauthenticated = new HttpEvidenceUploadTransport('x', { getAccessToken: async () => null }, 5_000, fetchFn);
    expect(await unauthenticated.upload(item)).toEqual({ kind: 'NOT_CONNECTED' });
  });

  test('HTTP transport uploads a native absolute path as a file:// URI (Android gives no scheme)', async () => {
    // Real device bug (2026-10-10): EvidenceRecorderModule returns file.absolutePath with no
    // scheme; without file://, Android's networking layer logged "Could not retrieve file for
    // contentUri /data/user/0/..." and the upload silently never reached the server.
    const item = { ...makeItem('ev-native-path'), filePath: '/data/user/0/com.sheguardai.app/files/evidence/evt-1/evidence-xyz.m4a' };
    const appendSpy = jest.fn();
    class FakeFormData {
      append = appendSpy;
    }
    const originalFormData = global.FormData;
    (global as any).FormData = FakeFormData;
    try {
      const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 201 });
      const transport = new HttpEvidenceUploadTransport('https://api.example/api/v1', { getAccessToken: async () => 'token-1' }, 5_000, fetchFn);
      await transport.upload(item);

      const fileCall = appendSpy.mock.calls.find((call) => call[0] === 'file');
      expect(fileCall?.[1]).toMatchObject({ uri: 'file:///data/user/0/com.sheguardai.app/files/evidence/evt-1/evidence-xyz.m4a' });
    } finally {
      global.FormData = originalFormData;
    }
  });

  test('HTTP transport maps 404 to EVENT_NOT_SYNCED and 415 to REJECTED', async () => {
    const item = makeItem('ev-http-2');
    const tokens = { getAccessToken: async () => 'token-1' };

    const notSynced = new HttpEvidenceUploadTransport('x', tokens, 5_000, jest.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await notSynced.upload(item)).toEqual({ kind: 'EVENT_NOT_SYNCED' });

    const rejected = new HttpEvidenceUploadTransport('x', tokens, 5_000, jest.fn().mockResolvedValue({ ok: false, status: 415 }));
    expect(await rejected.upload(item)).toEqual({ kind: 'REJECTED', message: 'HTTP 415' });
  });
});
