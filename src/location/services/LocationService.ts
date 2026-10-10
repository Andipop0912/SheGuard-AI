import { LocationPolicy } from '../../config/locationPolicy';
import { fixAgeMs, LocationFix } from '../domain/LocationFix';
import {
  INITIAL_LOCATION_READINESS,
  LocationAvailability,
  LocationPermissionStatus,
  LocationReadiness,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../domain/LocationState';
import { LocationNativeInterface } from '../native/LocationNativeBridge';
import { LocationPermissionGateway } from '../native/locationPermissions';

export type BestFixResult =
  | { kind: 'FRESH'; fix: LocationFix }
  | { kind: 'STALE'; fix: LocationFix }
  | { kind: 'NONE'; reason: LocationUnavailableReason };

/**
 * Device location for the app: readiness, one-off fixes and emergency tracking.
 *
 * - Never tracks continuously on its own; tracking runs only between startTracking()/stopTracking().
 * - Never invents coordinates: every fix comes from the native layer and is validated there.
 * - Never throws into callers; failures become states.
 */
export class LocationService {
  private readiness: LocationReadiness = INITIAL_LOCATION_READINESS;
  private trackingState: LocationTrackingState = LocationTrackingState.IDLE;
  private trackingFailureReason: string | null = null;
  private trackingRequested = false;
  private trackingOperation: Promise<void> = Promise.resolve();

  private readonly readinessListeners = new Set<(readiness: LocationReadiness) => void>();
  private readonly fixListeners = new Set<(fix: LocationFix) => void>();
  private readonly trackingListeners = new Set<(state: LocationTrackingState, reason: string | null) => void>();
  private unsubscribeNative: (() => void)[] = [];

  constructor(
    private readonly native: LocationNativeInterface,
    private readonly permissions: LocationPermissionGateway,
    private readonly policy: LocationPolicy,
    private readonly now: () => number = Date.now
  ) {}

  // ---------------------------------------------------------------- state

  public getReadiness(): LocationReadiness {
    return this.readiness;
  }

  public getTrackingState(): LocationTrackingState {
    return this.trackingState;
  }

  public getTrackingFailureReason(): string | null {
    return this.trackingFailureReason;
  }

  public subscribeReadiness(listener: (readiness: LocationReadiness) => void): () => void {
    this.readinessListeners.add(listener);
    listener(this.readiness);
    return () => this.readinessListeners.delete(listener);
  }

  public subscribeFixes(listener: (fix: LocationFix) => void): () => void {
    this.fixListeners.add(listener);
    return () => this.fixListeners.delete(listener);
  }

  public subscribeTracking(listener: (state: LocationTrackingState, reason: string | null) => void): () => void {
    this.trackingListeners.add(listener);
    listener(this.trackingState, this.trackingFailureReason);
    return () => this.trackingListeners.delete(listener);
  }

  public isFresh(fix: LocationFix): boolean {
    return fixAgeMs(fix, this.now()) <= this.policy.staleAfterMs;
  }

  // ---------------------------------------------------------------- readiness

  /** Re-reads permission, provider state and the cached last-known fix. Cheap; no GPS warm-up. */
  public async refreshReadiness(): Promise<LocationReadiness> {
    if (!this.native.isSupported()) {
      return this.setReadiness({
        availability: LocationAvailability.UNAVAILABLE,
        permission: this.readiness.permission,
        servicesEnabled: false,
        fix: this.readiness.fix,
        reason: LocationUnavailableReason.NOT_SUPPORTED,
      });
    }

    const permission = await this.permissions.check();
    // check() reports UNDETERMINED for "not granted"; keep a known DENIED/BLOCKED from request().
    const effectivePermission =
      permission === LocationPermissionStatus.UNDETERMINED &&
      (this.readiness.permission === LocationPermissionStatus.DENIED ||
        this.readiness.permission === LocationPermissionStatus.BLOCKED)
        ? this.readiness.permission
        : permission;

    const servicesEnabled = await this.native.isLocationServicesEnabled();

    if (effectivePermission !== LocationPermissionStatus.GRANTED) {
      return this.setReadiness({
        availability:
          effectivePermission === LocationPermissionStatus.UNDETERMINED
            ? LocationAvailability.PERMISSION_REQUIRED
            : LocationAvailability.PERMISSION_DENIED,
        permission: effectivePermission,
        servicesEnabled,
        fix: this.readiness.fix,
        reason: LocationUnavailableReason.PERMISSION,
      });
    }

    const lastKnown = await this.native.getLastKnownLocation();
    const fix = this.newer(this.readiness.fix, lastKnown);
    return this.setReadiness(this.readinessFor(permission, servicesEnabled, fix));
  }

  public async requestPermission(): Promise<LocationReadiness> {
    const result = await this.permissions.request();
    this.readiness = { ...this.readiness, permission: result };
    return this.refreshReadiness();
  }

  /** Asks the platform for a new fix (bounded by policy.currentFixTimeoutMs). */
  public async acquireCurrentFix(): Promise<LocationFix | null> {
    const ready = await this.refreshReadiness();
    if (ready.permission !== LocationPermissionStatus.GRANTED || !ready.servicesEnabled) {
      return null;
    }

    this.setReadiness({ ...ready, availability: LocationAvailability.ACQUIRING });
    const fix = await this.native.getCurrentLocation(this.policy.currentFixTimeoutMs);
    if (fix) {
      this.acceptFix(fix);
      return fix;
    }
    this.setReadiness(this.readinessFor(ready.permission, ready.servicesEnabled, this.readiness.fix));
    return null;
  }

  /**
   * Best location available right now WITHOUT waiting for GPS: the newest of the in-memory
   * fix and the platform's last-known fix, classified as FRESH or STALE.
   */
  public async getBestAvailableFixNow(): Promise<BestFixResult> {
    const ready = await this.refreshReadiness();
    if (ready.permission !== LocationPermissionStatus.GRANTED) {
      return { kind: 'NONE', reason: LocationUnavailableReason.PERMISSION };
    }
    if (!ready.fix) {
      return {
        kind: 'NONE',
        reason: ready.servicesEnabled ? LocationUnavailableReason.NO_FIX : LocationUnavailableReason.SERVICES_DISABLED,
      };
    }
    return this.isFresh(ready.fix) ? { kind: 'FRESH', fix: ready.fix } : { kind: 'STALE', fix: ready.fix };
  }

  // ---------------------------------------------------------------- tracking

  /** Idempotent. Starts native tracking at the emergency policy rate. */
  public startTracking(): Promise<void> {
    this.trackingRequested = true;
    console.info(`[LocationService] startTracking requested (r1); currentState=${this.trackingState}`);
    return this.enqueueTracking(async () => {
      if (!this.trackingRequested) {
        console.info('[LocationService] startTracking: request withdrawn before operation ran');
        return;
      }
      if (this.trackingState === LocationTrackingState.ACTIVE || this.trackingState === LocationTrackingState.STARTING) {
        console.info(`[LocationService] startTracking: already ${this.trackingState}, no-op`);
        return;
      }
      this.attachNativeListeners();
      this.setTracking(LocationTrackingState.STARTING, null);
      let result: Awaited<ReturnType<typeof this.native.startTracking>>;
      try {
        result = await this.native.startTracking(
          this.policy.emergencyUpdateIntervalMs,
          this.policy.emergencyMinDistanceMeters
        );
      } catch (e) {
        console.warn('[LocationService] native.startTracking rejected unexpectedly', e);
        this.setTracking(LocationTrackingState.FAILED, 'UNEXPECTED_ERROR');
        return;
      }
      console.info(`[LocationService] native.startTracking resolved ok=${result.ok}${result.ok ? '' : ` reason=${result.reason}`}`);
      if (!this.trackingRequested) {
        // stopTracking() arrived while starting.
        await this.native.stopTracking();
        this.setTracking(LocationTrackingState.IDLE, null);
        return;
      }
      if (result.ok) {
        this.setTracking(LocationTrackingState.ACTIVE, null);
      } else {
        this.setTracking(LocationTrackingState.FAILED, result.reason);
      }
    });
  }

  /** Idempotent. Stops native tracking. */
  public stopTracking(): Promise<void> {
    this.trackingRequested = false;
    return this.enqueueTracking(async () => {
      if (this.trackingRequested) return;
      if (this.trackingState === LocationTrackingState.IDLE) return;
      await this.native.stopTracking();
      this.setTracking(LocationTrackingState.IDLE, null);
    });
  }

  public async reverseGeocode(fix: LocationFix): Promise<string | null> {
    return this.native.reverseGeocode(fix.latitude, fix.longitude);
  }

  /** Releases native listeners. Tests only. */
  public dispose(): void {
    this.unsubscribeNative.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeNative = [];
  }

  // ---------------------------------------------------------------- internals

  private enqueueTracking(operation: () => Promise<void>): Promise<void> {
    // Serializes start/stop so rapid toggles cannot interleave native calls.
    this.trackingOperation = this.trackingOperation.then(operation, operation).catch(() => {
      this.setTracking(LocationTrackingState.FAILED, 'UNEXPECTED_ERROR');
    });
    return this.trackingOperation;
  }

  private attachNativeListeners(): void {
    if (this.unsubscribeNative.length > 0) return;
    this.unsubscribeNative = [
      this.native.onLocationUpdate((fix) => this.acceptFix(fix)),
      this.native.onTrackingStateChanged((event) => {
        if (event.state === 'FAILED') {
          this.setTracking(LocationTrackingState.FAILED, event.reason);
        } else if (event.state === 'STOPPED' && this.trackingState !== LocationTrackingState.IDLE) {
          // Stopped by the system (e.g. service killed) while we still wanted updates.
          this.setTracking(
            this.trackingRequested ? LocationTrackingState.FAILED : LocationTrackingState.IDLE,
            this.trackingRequested ? 'STOPPED_BY_SYSTEM' : null
          );
        }
      }),
    ];
  }

  private acceptFix(fix: LocationFix): void {
    const newest = this.newer(this.readiness.fix, fix);
    this.setReadiness(this.readinessFor(LocationPermissionStatus.GRANTED, true, newest));
    this.fixListeners.forEach((listener) => listener(fix));
  }

  private newer(a: LocationFix | null, b: LocationFix | null): LocationFix | null {
    if (!a) return b;
    if (!b) return a;
    return b.timestamp >= a.timestamp ? b : a;
  }

  private readinessFor(
    permission: LocationPermissionStatus,
    servicesEnabled: boolean,
    fix: LocationFix | null
  ): Omit<LocationReadiness, 'checkedAt'> {
    if (!fix) {
      return {
        availability: LocationAvailability.UNAVAILABLE,
        permission,
        servicesEnabled,
        fix: null,
        reason: servicesEnabled ? LocationUnavailableReason.NO_FIX : LocationUnavailableReason.SERVICES_DISABLED,
      };
    }
    return {
      availability: this.isFresh(fix) ? LocationAvailability.AVAILABLE : LocationAvailability.STALE,
      permission,
      servicesEnabled,
      fix,
      reason: null,
    };
  }

  private setReadiness(next: Omit<LocationReadiness, 'checkedAt'>): LocationReadiness {
    this.readiness = { ...next, checkedAt: this.now() };
    this.readinessListeners.forEach((listener) => listener(this.readiness));
    return this.readiness;
  }

  private setTracking(state: LocationTrackingState, reason: string | null): void {
    this.trackingState = state;
    this.trackingFailureReason = reason;
    this.trackingListeners.forEach((listener) => listener(state, reason));
  }
}
