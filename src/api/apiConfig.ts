declare const __DEV__: boolean;

/**
 * Backend endpoint configuration.
 *
 * Debug: the development backend on the PC. `localhost` reaches it through `adb reverse tcp:8000
 * tcp:8000` (USB). For a real offline test (airplane mode) set DEV_API_BASE_URL to the PC's Wi-Fi
 * address instead, because airplane mode does not cut the USB tunnel.
 *
 * Release: must be an https URL. While it is null, the app reports "server not configured" and
 * keeps every emergency on the phone; nothing is ever shown as synced.
 */
// Development backend through the USB tunnel (`adb reverse tcp:8000 tcp:8000`): independent of
// which Wi-Fi/tethering network the PC is on. For airplane-mode (offline) tests use the PC's
// Wi-Fi address instead, e.g. 'http://192.168.137.18:8000/api/v1' on the phone's hotspot.
export const DEV_API_BASE_URL = 'http://localhost:8000/api/v1';
export const RELEASE_API_BASE_URL: string | null = 'https://sheguard-ai-q4k1.onrender.com/api/v1';

export const API_TIMEOUT_MS = 10_000;
export const APP_VERSION = '1.0.0';

export function getApiBaseUrl(): string | null {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return DEV_API_BASE_URL;
  return RELEASE_API_BASE_URL && RELEASE_API_BASE_URL.startsWith('https://') ? RELEASE_API_BASE_URL : null;
}
