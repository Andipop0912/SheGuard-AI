import { SyncStatus } from '../../emergency/domain/SyncStatus';

export enum RouteSafetyStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

/** ON_ROUTE -> POSSIBLE_DEVIATION -> DEROUTED -> RETURNED_TO_ROUTE -> ON_ROUTE. See RouteDeviationDetector. */
export enum RouteDeviationState {
  ON_ROUTE = 'ON_ROUTE',
  POSSIBLE_DEVIATION = 'POSSIBLE_DEVIATION',
  DEROUTED = 'DEROUTED',
  RETURNED_TO_ROUTE = 'RETURNED_TO_ROUTE',
}

export interface RoutePoint {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * A Route Safety session: the user's declared start/destination, the original (authoritative)
 * route geometry, and the live tracking/deviation state built on top of the existing location
 * pipeline. Local-first — this is the device's own copy; the backend holds a synchronized one
 * for trusted-contact access, never the source of truth for local monitoring.
 */
export interface RouteSafetySession {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly status: RouteSafetyStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;

  readonly startLocation: RoutePoint;
  readonly destinationText: string;
  readonly destinationLocation: RoutePoint | null;

  /** The original planned route. Never silently replaced while this session is ACTIVE. */
  readonly routePolyline: RoutePoint[];
  readonly routeDistanceMeters: number | null;
  readonly routeDurationSeconds: number | null;

  readonly currentLocation: RoutePoint | null;
  readonly lastLocationAt: number | null;

  readonly deviationState: RouteDeviationState;
  /** When the current deviationState began (drives the confirmation-duration checks). */
  readonly deviationStateSince: number | null;
  /** Set once an alert has been sent for the current deviation incident; cleared on ON_ROUTE. */
  readonly deviationAlertSentAt: number | null;

  readonly startNotificationSent: boolean;
  readonly syncStatus: SyncStatus;
}

export function createRouteSafetySession(params: {
  sessionId: string;
  userId: string;
  deviceId: string;
  startLocation: RoutePoint;
  destinationText: string;
  destinationLocation: RoutePoint | null;
  routePolyline: RoutePoint[];
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
  startedAt?: number;
}): RouteSafetySession {
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    deviceId: params.deviceId,
    status: RouteSafetyStatus.ACTIVE,
    startedAt: params.startedAt ?? Date.now(),
    endedAt: null,
    startLocation: params.startLocation,
    destinationText: params.destinationText,
    destinationLocation: params.destinationLocation,
    routePolyline: params.routePolyline,
    routeDistanceMeters: params.routeDistanceMeters,
    routeDurationSeconds: params.routeDurationSeconds,
    currentLocation: params.startLocation,
    lastLocationAt: params.startedAt ?? Date.now(),
    deviationState: RouteDeviationState.ON_ROUTE,
    deviationStateSince: params.startedAt ?? Date.now(),
    deviationAlertSentAt: null,
    startNotificationSent: false,
    syncStatus: SyncStatus.PENDING,
  };
}

export function isRouteSafetyActive(session: RouteSafetySession | null): session is RouteSafetySession {
  return !!session && session.status === RouteSafetyStatus.ACTIVE;
}
