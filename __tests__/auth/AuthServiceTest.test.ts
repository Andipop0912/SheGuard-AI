import {
  UNCLAIMED_USER_ID,
  getEventOwner,
  loadInstallDeviceId,
  resetIdentityForTesting,
} from '../../src/app/identity';
import { AuthState } from '../../src/auth/domain/AuthState';
import { normalizePhone, validatePassword } from '../../src/auth/credentials';
import { buildStack } from '../net/fakes';

describe('credentials', () => {
  test('phone numbers normalize to E.164 (+91 default)', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('098765-43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('98765abc10')).toBeNull();
    expect(normalizePhone('+91+9876543210')).toBeNull();
  });

  test('password rules match the backend (6–100 chars, ≤72 bytes for bcrypt)', () => {
    expect(validatePassword('12345')).toMatch(/at least 6/);
    expect(validatePassword('secret123')).toBeNull();
    expect(validatePassword('a'.repeat(73))).toBe('Password is too long.');
    expect(validatePassword('é'.repeat(37))).toBe('Password is too long.'); // 74 bytes
  });
});

describe('AuthService', () => {
  beforeEach(() => resetIdentityForTesting());

  test('register: binds this install’s device id, stores the session securely, owner becomes the user', async () => {
    const { auth, backend, secureStore } = buildStack();
    await auth.restore();
    expect(getEventOwner().userId).toBe(UNCLAIMED_USER_ID);

    const result = await auth.register('98765 43210', 'secret123');
    expect(result.ok).toBe(true);

    const deviceId = await loadInstallDeviceId();
    const call = backend.callsTo('/auth/register')[0];
    expect(call.body).toMatchObject({ phone: '+919876543210', deviceId, platform: 'android' });

    expect(auth.getSnapshot().state).toBe(AuthState.AUTHENTICATED);
    expect(auth.getSession()).toMatchObject({ phone: '+919876543210', deviceId });
    expect(getEventOwner()).toEqual({ userId: auth.getSession()!.userId, deviceId });

    // Only the refresh token is persisted (no password, no access token).
    const stored = Array.from(secureStore.values.values()).join(' ');
    expect(stored).not.toContain('secret123');
    expect(stored).not.toMatch(/at-\d/);
    expect(stored).toMatch(/rt-\d/);
  });

  test('duplicate registration and wrong password give honest messages; state stays signed out', async () => {
    const { auth } = buildStack();
    await auth.restore();
    await auth.register('9876543210', 'secret123');
    await auth.logout();

    const dup = await auth.register('9876543210', 'secret123');
    expect(dup).toEqual({ ok: false, message: 'User with this phone number already exists.' });

    const wrong = await auth.login('9876543210', 'nope-nope');
    expect(wrong).toEqual({ ok: false, message: 'Incorrect mobile number or password.' });
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
  });

  test('inactive account → 403 message', async () => {
    const { auth, backend } = buildStack();
    backend.seedUser('+919876543210', 'secret123');
    backend.setUserActive('+919876543210', false);
    expect(await auth.login('9876543210', 'secret123')).toEqual({ ok: false, message: 'This account is inactive.' });
  });

  test('invalid input is rejected before any request', async () => {
    const { auth, backend } = buildStack();
    expect((await auth.register('123', 'secret123')).ok).toBe(false);
    expect((await auth.register('9876543210', '123')).ok).toBe(false);
    expect(backend.calls).toHaveLength(0);
  });

  test('offline sign-in fails honestly and mentions offline safety', async () => {
    const { auth, backend } = buildStack();
    backend.offline = true;
    const res = await auth.login('9876543210', 'secret123');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/still work offline/);
  });

  test('session restore needs no network', async () => {
    const first = buildStack();
    await first.auth.register('9876543210', 'secret123');
    const before = first.backend.calls.length;

    first.backend.offline = true;
    const restarted = buildStack({ backend: first.backend, secureStore: first.secureStore });
    await restarted.auth.restore();
    expect(restarted.auth.getSnapshot().state).toBe(AuthState.AUTHENTICATED);
    expect(restarted.auth.getSession()?.phone).toBe('+919876543210');
    expect(first.backend.calls.length).toBe(before);
  });

  test('unreadable secure storage at launch → signed out (never crashes)', async () => {
    const { auth, secureStore } = buildStack();
    secureStore.failReads = true;
    await auth.restore();
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
  });

  test('secure storage write failure → sign-in reported as failed, nothing half-saved', async () => {
    const { auth, secureStore } = buildStack();
    secureStore.failWrites = true;
    const res = await auth.register('9876543210', 'secret123');
    expect(res).toEqual({ ok: false, message: 'Could not save your session securely on this phone.' });
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
  });

  test('refresh rotates and persists the new refresh token', async () => {
    const { auth, secureStore } = buildStack();
    await auth.register('9876543210', 'secret123');
    const before = Array.from(secureStore.values.values())[0];
    expect(await auth.refreshOnce()).toBe('REFRESHED');
    const after = Array.from(secureStore.values.values())[0];
    expect(after).not.toBe(before);
  });

  // Regression (physical Test 6, 2026-10-07): after a refresh, memory kept the old (revoked) token.
  test('REGRESSION: two refreshes in one app run both succeed and the latest rotated token is current', async () => {
    const { auth, backend, secureStore } = buildStack();
    await auth.register('9876543210', 'secret123');
    const storedToken = () => JSON.parse(Array.from(secureStore.values.values())[0]).refreshToken as string;

    expect(await auth.refreshOnce()).toBe('REFRESHED');
    const afterFirst = storedToken();

    // Same AuthService instance, no restart.
    expect(await auth.refreshOnce()).toBe('REFRESHED');
    const refreshCalls = backend.callsTo('/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
    // Refresh #2 must present the token issued by refresh #1 (not the revoked original).
    expect(refreshCalls[1].body.refreshToken).toBe(afterFirst);

    expect(auth.getSnapshot().state).toBe(AuthState.AUTHENTICATED);
    const current = storedToken();
    expect(current).not.toBe(afterFirst);
    expect(backend.isRefreshTokenActive(current)).toBe(true);
    expect(backend.activeRefreshTokenCount()).toBe(1);
  });

  test('REGRESSION: logout after a refresh revokes the CURRENT server session (not just HTTP 200)', async () => {
    const { auth, backend, secureStore } = buildStack();
    await auth.register('9876543210', 'secret123');
    const deviceIdBefore = await loadInstallDeviceId();

    expect(await auth.refreshOnce()).toBe('REFRESHED');
    const current = JSON.parse(Array.from(secureStore.values.values())[0]).refreshToken as string;
    expect(backend.isRefreshTokenActive(current)).toBe(true);

    await auth.logout();

    const logoutCall = backend.callsTo('/auth/logout')[0];
    expect(logoutCall.body.refreshToken).toBe(current);
    expect(backend.isRefreshTokenActive(current)).toBe(false);
    expect(backend.activeRefreshTokenCount()).toBe(0);
    expect(secureStore.values.size).toBe(0);
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
    expect(await loadInstallDeviceId()).toBe(deviceIdBefore);
  });

  test('logout online revokes the server session and clears local tokens; owner reverts to unclaimed', async () => {
    const { auth, backend, secureStore } = buildStack();
    await auth.register('9876543210', 'secret123');
    expect(backend.activeRefreshTokenCount()).toBe(1);
    await auth.logout();
    expect(backend.activeRefreshTokenCount()).toBe(0);
    expect(secureStore.values.size).toBe(0);
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
    expect(getEventOwner().userId).toBe(UNCLAIMED_USER_ID);
  });

  test('logout offline still signs out locally', async () => {
    const { auth, backend, secureStore } = buildStack();
    await auth.register('9876543210', 'secret123');
    backend.offline = true;
    await auth.logout();
    expect(secureStore.values.size).toBe(0);
    expect(auth.getSnapshot().state).toBe(AuthState.UNAUTHENTICATED);
  });
});

describe('install device identity', () => {
  beforeEach(() => resetIdentityForTesting());

  test('generated once and reused after a restart', async () => {
    const id = await loadInstallDeviceId();
    expect(id).toMatch(/^android-[0-9a-f]+-[0-9a-f]{24}$/);
    expect(await loadInstallDeviceId()).toBe(id);

    resetIdentityForTesting(); // new JS runtime, same storage
    expect(await loadInstallDeviceId()).toBe(id);
  });

  test('concurrent loads produce one id', async () => {
    const ids = await Promise.all([loadInstallDeviceId(), loadInstallDeviceId(), loadInstallDeviceId()]);
    expect(new Set(ids).size).toBe(1);
  });

  test('event owner is synchronous and works before anything is loaded', () => {
    expect(getEventOwner()).toEqual({ userId: UNCLAIMED_USER_ID, deviceId: 'device-not-loaded' });
  });
});
