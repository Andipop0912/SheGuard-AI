declare const require: any;

/**
 * The single source of identity for this install.
 *
 * - Device id: generated once per install, persisted (not a secret). Survives restarts and app
 *   updates; a reinstall or "Clear data" creates a new one, which the backend binds as a new device.
 * - Event owner: the signed-in user, or UNCLAIMED_USER_ID when signed out. Read synchronously from
 *   memory so the emergency trigger path never waits on storage, network or authentication.
 */

/** Owner of emergencies recorded while signed out; claimed by the next account that signs in here. */
export const UNCLAIMED_USER_ID = 'local-unclaimed';
/** Placeholder used until the install device id has been loaded (replaced at upload time). */
export const DEVICE_ID_NOT_LOADED = 'device-not-loaded';

const DEVICE_ID_KEY = '@sheguard_device_id_v1';

let AsyncStorage: any = null;
try {
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
} catch {
  AsyncStorage = null;
}

let installDeviceId: string | null = null;
let loading: Promise<string> | null = null;
let signedInUserId: string | null = null;

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ((Math.random() * 16) | 0).toString(16);
  return out;
}

function generateDeviceId(): string {
  // 64-bit time + 96 random bits; uniqueness is all that is needed (the id is not a secret).
  return `android-${Date.now().toString(16)}-${randomHex(24)}`;
}

/** Loads (or creates once) the persisted install device id. Safe to call repeatedly. */
export function loadInstallDeviceId(): Promise<string> {
  if (installDeviceId) return Promise.resolve(installDeviceId);
  if (!loading) {
    loading = (async () => {
      let id: string | null = null;
      try {
        id = AsyncStorage ? await AsyncStorage.getItem(DEVICE_ID_KEY) : null;
      } catch {
        id = null;
      }
      if (!id) {
        id = generateDeviceId();
        try {
          await AsyncStorage?.setItem(DEVICE_ID_KEY, id);
        } catch {
          // Kept in memory for this run; a new id would be generated next launch.
        }
      }
      installDeviceId = id;
      return id;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** Synchronous, I/O-free owner for a new emergency event. */
export function getEventOwner(): { userId: string; deviceId: string } {
  return {
    userId: signedInUserId ?? UNCLAIMED_USER_ID,
    deviceId: installDeviceId ?? DEVICE_ID_NOT_LOADED,
  };
}

/** Called by AuthService when the session changes. */
export function setSignedInUser(userId: string | null): void {
  signedInUserId = userId;
}

/** Tests only. */
export function resetIdentityForTesting(): void {
  installDeviceId = null;
  loading = null;
  signedInUserId = null;
}
