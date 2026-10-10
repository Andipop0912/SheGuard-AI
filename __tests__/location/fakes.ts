import { LocationFix, LocationProvider } from '../../src/location/domain/LocationFix';
import { LocationPermissionStatus } from '../../src/location/domain/LocationState';
import {
  LocationNativeInterface,
  NativeTrackingEvent,
  StartTrackingResult,
} from '../../src/location/native/LocationNativeBridge';
import { LocationPermissionGateway } from '../../src/location/native/locationPermissions';
import { LocationPolicy } from '../../src/config/locationPolicy';

export const NOW = 1_800_000_000_000;

export const testPolicy: LocationPolicy = {
  staleAfterMs: 120_000,
  currentFixTimeoutMs: 1_000,
  emergencyUpdateIntervalMs: 15_000,
  emergencyMinDistanceMeters: 10,
  maxPointsPerEmergency: 2000,
  syncBatchSize: 50,
  syncRetryInitialMs: 1_000,
  syncRetryMaxMs: 8_000,
};

export function fix(overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    latitude: 19.076,
    longitude: 72.8777,
    accuracyMeters: 8,
    altitudeMeters: null,
    speedMps: null,
    headingDegrees: null,
    timestamp: NOW - 5_000,
    provider: LocationProvider.FUSED,
    isLastKnown: false,
    ...overrides,
  };
}

export class FakePermissions implements LocationPermissionGateway {
  constructor(
    public status: LocationPermissionStatus = LocationPermissionStatus.GRANTED,
    public requestResult: LocationPermissionStatus = LocationPermissionStatus.GRANTED
  ) {}

  public async check(): Promise<LocationPermissionStatus> {
    return this.status === LocationPermissionStatus.GRANTED
      ? LocationPermissionStatus.GRANTED
      : LocationPermissionStatus.UNDETERMINED;
  }

  public async request(): Promise<LocationPermissionStatus> {
    this.status = this.requestResult;
    return this.requestResult;
  }
}

/** Scriptable stand-in for the Android module. Records every call. */
export class FakeLocationNative implements LocationNativeInterface {
  public supported = true;
  public servicesEnabled = true;
  public lastKnown: LocationFix | null = null;
  public current: LocationFix | null = null;
  public startResult: StartTrackingResult = { ok: true };
  public startCalls = 0;
  public stopCalls = 0;
  public currentCalls = 0;
  public tracking = false;
  private updateListeners = new Set<(fix: LocationFix) => void>();
  private stateListeners = new Set<(event: NativeTrackingEvent) => void>();

  public isSupported(): boolean {
    return this.supported;
  }
  public async isLocationServicesEnabled(): Promise<boolean> {
    return this.servicesEnabled;
  }
  public async getLastKnownLocation(): Promise<LocationFix | null> {
    return this.lastKnown;
  }
  public async getCurrentLocation(): Promise<LocationFix | null> {
    this.currentCalls++;
    return this.current;
  }
  public async startTracking(): Promise<StartTrackingResult> {
    this.startCalls++;
    if (this.startResult.ok) this.tracking = true;
    return this.startResult;
  }
  public async stopTracking(): Promise<void> {
    this.stopCalls++;
    this.tracking = false;
  }
  public async reverseGeocode(): Promise<string | null> {
    return null;
  }
  public onLocationUpdate(callback: (fix: LocationFix) => void): () => void {
    this.updateListeners.add(callback);
    return () => this.updateListeners.delete(callback);
  }
  public onTrackingStateChanged(callback: (event: NativeTrackingEvent) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  /** Simulates a tracking update from the device. */
  public emitUpdate(update: LocationFix): void {
    this.updateListeners.forEach((listener) => listener(update));
  }
}

/** Lets queued promise callbacks (listeners, async storage mock) run. */
export async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}
