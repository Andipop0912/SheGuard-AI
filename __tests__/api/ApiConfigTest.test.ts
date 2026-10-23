import { DEV_API_BASE_URL, RELEASE_API_BASE_URL, getApiBaseUrl } from '../../src/api/apiConfig';

const FORBIDDEN_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2', '192.168.'];

describe('apiConfig — production backend wiring', () => {
  const originalDev = (global as any).__DEV__;

  afterEach(() => {
    (global as any).__DEV__ = originalDev;
  });

  test('RELEASE_API_BASE_URL is the real Render HTTPS backend, not a local/emulator address', () => {
    expect(RELEASE_API_BASE_URL).toBe('https://sheguard-ai-q4k1.onrender.com/api/v1');
    expect(RELEASE_API_BASE_URL).toMatch(/^https:\/\//);
    FORBIDDEN_HOSTS.forEach((host) => expect(RELEASE_API_BASE_URL).not.toContain(host));
  });

  test('a release build (DEV=false) resolves to the production Render URL', () => {
    (global as any).__DEV__ = false;
    const url = getApiBaseUrl();
    expect(url).toBe('https://sheguard-ai-q4k1.onrender.com/api/v1');
    FORBIDDEN_HOSTS.forEach((host) => expect(url).not.toContain(host));
  });

  test('a debug build (DEV=true) still resolves to the local dev backend, unaffected by release config', () => {
    (global as any).__DEV__ = true;
    expect(getApiBaseUrl()).toBe(DEV_API_BASE_URL);
  });
});
