import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { LocationFix, parseLocationFix } from '../domain/LocationFix';

const { SheGuardLocationModule } = NativeModules;

export type NativeTrackingEvent =
  | { state: 'STARTED' }
  | { state: 'STOPPED' }
  | { state: 'FAILED'; reason: string };

export type StartTrackingResult = { ok: true } | { ok: false; reason: string };

/**
 * Boundary to the Android location module. Provider details (Fused vs LocationManager)
 * stay on the native side; this interface only speaks in validated LocationFix values.
 */
export interface LocationNativeInterface {
  isSupported(): boolean;
  isLocationServicesEnabled(): Promise<boolean>;
  getLastKnownLocation(): Promise<LocationFix | null>;
  getCurrentLocation(timeoutMs: number): Promise<LocationFix | null>;
  startTracking(intervalMs: number, minDistanceMeters: number): Promise<StartTrackingResult>;
  stopTracking(): Promise<void>;
  reverseGeocode(latitude: number, longitude: number): Promise<string | null>;
  onLocationUpdate(callback: (fix: LocationFix) => void): () => void;
  onTrackingStateChanged(callback: (event: NativeTrackingEvent) => void): () => void;
}

export class LocationNativeModule implements LocationNativeInterface {
  private readonly emitter: NativeEventEmitter | null;

  constructor() {
    this.emitter =
      Platform.OS === 'android' && SheGuardLocationModule ? new NativeEventEmitter(SheGuardLocationModule) : null;
  }

  public isSupported(): boolean {
    return Platform.OS === 'android' && !!SheGuardLocationModule;
  }

  public async isLocationServicesEnabled(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      return (await SheGuardLocationModule.isLocationServicesEnabled()) === true;
    } catch {
      return false;
    }
  }

  public async getLastKnownLocation(): Promise<LocationFix | null> {
    if (!this.isSupported()) return null;
    try {
      return parseLocationFix(await SheGuardLocationModule.getLastKnownLocation());
    } catch {
      return null;
    }
  }

  public async getCurrentLocation(timeoutMs: number): Promise<LocationFix | null> {
    if (!this.isSupported()) return null;
    try {
      return parseLocationFix(await SheGuardLocationModule.getCurrentLocation(timeoutMs));
    } catch {
      return null;
    }
  }

  public async startTracking(intervalMs: number, minDistanceMeters: number): Promise<StartTrackingResult> {
    if (!this.isSupported()) return { ok: false, reason: 'NOT_SUPPORTED' };
    try {
      await SheGuardLocationModule.startTracking(intervalMs, minDistanceMeters);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      return { ok: false, reason: code ?? 'START_FAILED' };
    }
  }

  public async stopTracking(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await SheGuardLocationModule.stopTracking();
    } catch {
      // Stopping must never throw into emergency handling.
    }
  }

  public async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    if (!this.isSupported()) return null;
    try {
      const address = await SheGuardLocationModule.reverseGeocode(latitude, longitude);
      return typeof address === 'string' && address.trim().length > 0 ? address : null;
    } catch {
      return null;
    }
  }

  public onLocationUpdate(callback: (fix: LocationFix) => void): () => void {
    if (!this.emitter) return () => {};
    const sub = this.emitter.addListener('LOCATION_UPDATE', (raw: unknown) => {
      const fix = parseLocationFix(raw);
      if (fix) callback(fix);
    });
    return () => sub.remove();
  }

  public onTrackingStateChanged(callback: (event: NativeTrackingEvent) => void): () => void {
    if (!this.emitter) return () => {};
    const sub = this.emitter.addListener('LOCATION_TRACKING_STATE', (raw: { state?: string; reason?: string }) => {
      if (raw?.state === 'STARTED') callback({ state: 'STARTED' });
      else if (raw?.state === 'STOPPED') callback({ state: 'STOPPED' });
      else if (raw?.state === 'FAILED') callback({ state: 'FAILED', reason: raw.reason ?? 'UNKNOWN' });
    });
    return () => sub.remove();
  }
}
