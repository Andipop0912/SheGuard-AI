import { LocationFix } from './LocationFix';

/** Location permission as the app sees it. BLOCKED = denied with "don't ask again". */
export enum LocationPermissionStatus {
  UNDETERMINED = 'UNDETERMINED',
  GRANTED = 'GRANTED',
  DENIED = 'DENIED',
  BLOCKED = 'BLOCKED',
}

/** Overall device location availability (app readiness, not tied to any emergency). */
export enum LocationAvailability {
  UNAVAILABLE = 'UNAVAILABLE',
  PERMISSION_REQUIRED = 'PERMISSION_REQUIRED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ACQUIRING = 'ACQUIRING',
  AVAILABLE = 'AVAILABLE',
  STALE = 'STALE',
  ERROR = 'ERROR',
}

/** Why location is unavailable, when it is. */
export enum LocationUnavailableReason {
  PERMISSION = 'PERMISSION',
  SERVICES_DISABLED = 'SERVICES_DISABLED',
  NO_FIX = 'NO_FIX',
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  ERROR = 'ERROR',
}

export interface LocationReadiness {
  readonly availability: LocationAvailability;
  readonly permission: LocationPermissionStatus;
  readonly servicesEnabled: boolean;
  /** Most recent valid fix known to the app, if any. */
  readonly fix: LocationFix | null;
  readonly reason: LocationUnavailableReason | null;
  readonly checkedAt: number | null;
}

export const INITIAL_LOCATION_READINESS: LocationReadiness = {
  availability: LocationAvailability.UNAVAILABLE,
  permission: LocationPermissionStatus.UNDETERMINED,
  servicesEnabled: false,
  fix: null,
  reason: null,
  checkedAt: null,
};

/** Location state of one emergency (linked by eventId; EmergencyEvent itself is unchanged). */
export enum EmergencyLocationStatus {
  /** Emergency exists, a fix is still being looked for. */
  PENDING = 'PENDING',
  /** A fresh fix is attached. */
  AVAILABLE = 'AVAILABLE',
  /** Only an old/last-known fix is attached. */
  STALE = 'STALE',
  /** No fix could be obtained (see reason). */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Tracking lifecycle of the native location service for an emergency. */
export enum LocationTrackingState {
  IDLE = 'IDLE',
  STARTING = 'STARTING',
  ACTIVE = 'ACTIVE',
  /** Platform refused to start tracking (e.g. app in background, permission missing). */
  FAILED = 'FAILED',
}

export interface EmergencyLocationState {
  readonly eventId: string;
  readonly status: EmergencyLocationStatus;
  readonly reason: LocationUnavailableReason | null;
  readonly latestFix: LocationFix | null;
  readonly pointCount: number;
  readonly tracking: LocationTrackingState;
  readonly trackingFailureReason: string | null;
}
