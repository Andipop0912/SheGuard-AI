import { HttpClient, parseErrorDetail } from '../../src/api/HttpClient';
import { resetIdentityForTesting } from '../../src/app/identity';
import { AuthState } from '../../src/auth/domain/AuthState';
import { FAKE_BASE_URL, FakeBackend, buildStack } from '../net/fakes';

describe('HttpClient', () => {
  test('no base URL → NOT_CONFIGURED without any request', async () => {
    const fetchFn = jest.fn();
    const http = new HttpClient(() => null, 1000, fetchFn);
    const res = await http.request({ method: 'GET', path: '/x' });
    expect(res).toEqual({ ok: false, error: { kind: 'NOT_CONFIGURED' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('offline → NETWORK error (never throws)', async () => {
    const backend = new FakeBackend();
    backend.offline = true;
    const res = await new HttpClient(() => FAKE_BASE_URL, 1000, backend.fetch).request({ method: 'POST', path: '/auth/login', body: {} });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('NETWORK');
  });

  test('server that never answers → TIMEOUT', async () => {
    const backend = new FakeBackend();
    backend.hang = true;
    const res = await new HttpClient(() => FAKE_BASE_URL, 30, backend.fetch).request({ method: 'POST', path: '/auth/login', body: {} });
    expect(!res.ok && res.error.kind).toBe('TIMEOUT');
  });

  test('FastAPI error bodies are parsed (string detail, validation list)', () => {
    expect(parseErrorDetail({ detail: 'Invalid phone number or password.' })).toBe('Invalid phone number or password.');
    expect(parseErrorDetail({ detail: [{ msg: 'a' }, { msg: 'b' }] })).toBe('a; b');
    expect(parseErrorDetail({ detail: 'x', path: '/p' })).toBe('x');
    expect(parseErrorDetail(null)).toBeNull();
  });

  test('non-JSON 2xx body → PARSE', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200, text: async () => '<html>' }) as unknown as Response);
    const res = await new HttpClient(() => FAKE_BASE_URL, 1000, fetchFn).request({ method: 'GET', path: '/x' });
    expect(!res.ok && res.error.kind).toBe('PARSE');
  });
});

describe('ApiClient (Bearer, refresh once, retry once)', () => {
  beforeEach(() => resetIdentityForTesting());

  const signedIn = async () => {
    const stack = buildStack();
    const result = await stack.auth.register('9876543210', 'secret123');
    expect(result.ok).toBe(true);
    return stack;
  };
  const syncBody = { events: [] as unknown[] };

  test('signed out → SIGNED_OUT without a request', async () => {
    const { api, backend } = buildStack();
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(!res.ok && res.error.kind).toBe('SIGNED_OUT');
    expect(backend.calls).toHaveLength(0);
  });

  test('attaches the Bearer access token', async () => {
    const { api, backend } = await signedIn();
    await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(backend.callsTo('/emergencies/sync')[0].authorization).toMatch(/^Bearer at-/);
  });

  test('expired token: 401 → one refresh → one retry → success', async () => {
    const { api, backend } = await signedIn();
    backend.expireAccessTokens();
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(res.ok).toBe(true);
    expect(backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(backend.callsTo('/emergencies/sync')).toHaveLength(2);
  });

  test('second 401 after a successful refresh is returned, not looped', async () => {
    const { api, backend } = await signedIn();
    backend.expireAccessTokens();
    backend.forced.push({ path: '/emergencies/sync', status: 401 }, { path: '/emergencies/sync', status: 401 });
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(!res.ok && res.error.kind === 'HTTP' && res.error.status).toBe(401);
    expect(backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(backend.callsTo('/emergencies/sync')).toHaveLength(2);
  });

  test('5 concurrent 401s share exactly one refresh (rotation-safe)', async () => {
    const { api, backend, auth } = await signedIn();
    backend.expireAccessTokens();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody }))
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(backend.callsTo('/auth/refresh')).toHaveLength(1);
    expect(auth.getSnapshot().state).toBe(AuthState.AUTHENTICATED);
  });

  test('refresh rejected → session ends, request fails as SIGNED_OUT', async () => {
    const { api, backend, auth, secureStore } = await signedIn();
    backend.expireAccessTokens();
    backend.revokeAllRefreshTokens();
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(!res.ok && res.error.kind).toBe('SIGNED_OUT');
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
    expect(secureStore.values.size).toBe(0);
  });

  test('network failure during refresh keeps the session (fails honestly, retry later)', async () => {
    const { api, backend, auth } = await signedIn();
    backend.expireAccessTokens();
    backend.forced.push({ path: '/emergencies/sync', status: 401 });
    // The refresh request itself fails with a server error.
    backend.forced.push({ path: '/auth/refresh', status: 503 });
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(res.ok).toBe(false);
    expect(auth.getSnapshot().state).toBe(AuthState.AUTHENTICATED);
  });

  test('403 device no longer authorized → signed out locally', async () => {
    const { api, backend, auth } = await signedIn();
    const session = auth.getSession()!;
    backend.deactivateDevice(session.userId, session.deviceId);
    const res = await api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(!res.ok && res.error.kind).toBe('SIGNED_OUT');
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
  });

  test('after a restart (refresh token only) the first request refreshes first', async () => {
    const first = await signedIn();
    const restarted = buildStack({ backend: first.backend, secureStore: first.secureStore });
    await restarted.auth.restore();
    const res = await restarted.api.authorizedRequest({ method: 'POST', path: '/emergencies/sync', body: syncBody });
    expect(res.ok).toBe(true);
    expect(first.backend.callsTo('/auth/refresh')).toHaveLength(1);
  });
});
