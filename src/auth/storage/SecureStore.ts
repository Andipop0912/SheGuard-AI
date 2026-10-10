import { NativeModules, Platform } from 'react-native';

/**
 * Small key/value store for secrets (the refresh token). Values are encrypted on Android with
 * an AES-256-GCM key held in the Android Keystore (SheGuardSecureStorage native module).
 * Secrets are never written to AsyncStorage.
 */
export interface SecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const { SheGuardSecureStorage } = NativeModules;

export class NativeSecureStore implements SecureStore {
  public static isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardSecureStorage;
  }

  public getItem(key: string): Promise<string | null> {
    return SheGuardSecureStorage.getItem(key);
  }

  public async setItem(key: string, value: string): Promise<void> {
    await SheGuardSecureStorage.setItem(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    await SheGuardSecureStorage.removeItem(key);
  }
}

/**
 * Used where the native module does not exist (unit tests). Keeps secrets in memory only, so a
 * session never outlives the process; it never falls back to unencrypted persistent storage.
 */
export class InMemorySecureStore implements SecureStore {
  private readonly values = new Map<string, string>();

  public async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export function createSecureStore(): SecureStore {
  return NativeSecureStore.isAvailable() ? new NativeSecureStore() : new InMemorySecureStore();
}
