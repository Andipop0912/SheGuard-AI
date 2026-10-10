import { LocationPolicy } from '../../config/locationPolicy';
import { LocationFix, fixAgeMs } from '../domain/LocationFix';
import {
  EmergencyLocationState,
  LocationPermissionStatus,
  LocationReadiness,
  LocationTrackingState,
} from '../domain/LocationState';
import { LocationSyncState } from '../sync/LocationSyncQueue';

/**
 * Live Location state, derived ONLY from the existing location layer (LocationService readiness,
 * tracking state, emergency location). Nothing here reads GPS.
 *
 * Freshness (from the existing locationPolicy, not new numbers):
 *  - LIVE    tracking ACTIVE and the newest fix is at most 2 × emergencyUpdateIntervalMs old
 *            (i.e. no more than one expected update missed)
 *  - RECENT  fix younger than staleAfterMs, but not live (tracking off, or updates paused)
 *  - STALE   fix older than staleAfterMs
 */
export type LiveLocationState =
  | 'LIVE'
  | 'RECENT'
  | 'STALE'
  | 'ACQUIRING'
  | 'UNAVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'SERVICES_OFF';

export type LiveTone = 'good' | 'warn' | 'bad' | 'off';

export interface LiveLocationInput {
  readiness: LocationReadiness;
  tracking: LocationTrackingState;
  emergencyLocation: EmergencyLocationState | null;
  /** Id of the open emergency, if any (from EmergencyCoordinator via the emergency store). */
  openEmergencyId: string | null;
  sync: LocationSyncState;
  now: number;
  policy: LocationPolicy;
}

export interface PresentedLiveLocation {
  state: LiveLocationState;
  /** Short status, e.g. "Live", "Stale". Never "Live" unless fresh fixes are arriving. */
  label: string;
  tone: LiveTone;
  /** Newest fix known to the app (null = none). */
  fix: LocationFix | null;
  /** "Updated 12 s ago" / "Last updated 3 min ago". */
  updatedText: string | null;
  /** "±9 m" when the platform reported accuracy; null otherwise (never invented). */
  accuracyText: string | null;
  /** Tracking line for the open emergency, or null outside an emergency. */
  trackingText: string | null;
  /** Upload state of emergency location points (never claims server sync it does not have). */
  serverText: string | null;
  /** What the user can do, if anything. */
  action: 'REQUEST_PERMISSION' | 'OPEN_SETTINGS' | 'REFRESH' | null;
}

export function liveWindowMs(policy: LocationPolicy): number {
  return 2 * policy.emergencyUpdateIntervalMs;
}

export function describeAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

function newest(a: LocationFix | null, b: LocationFix | null): LocationFix | null {
  if (!a) return b;
  if (!b) return a;
  return b.timestamp >= a.timestamp ? b : a;
}

export function presentLiveLocation(input: LiveLocationInput): PresentedLiveLocation {
  const { readiness, tracking, emergencyLocation, openEmergencyId, sync, now, policy } = input;
  const emergencyFix =
    emergencyLocation && openEmergencyId && emergencyLocation.eventId === openEmergencyId
      ? emergencyLocation.latestFix
      : null;
  const fix = newest(readiness.fix, emergencyFix);
  const inEmergency = !!openEmergencyId;

  const trackingText = !inEmergency
    ? null
    : tracking === LocationTrackingState.ACTIVE
      ? 'Emergency tracking on'
      : tracking === LocationTrackingState.STARTING
        ? 'Emergency tracking starting…'
        : tracking === LocationTrackingState.FAILED
          ? 'Emergency tracking paused — keep SheGuard open to resume'
          : 'Emergency tracking off';

  const serverText = !inEmergency
    ? null
    : sync.kind === 'SYNCING'
      ? 'Uploading location to the server…'
      : sync.pending > 0
        ? `${sync.pending} location point${sync.pending === 1 ? '' : 's'} not uploaded yet`
        : 'Location points uploaded';

  const accuracyText =
    fix && fix.accuracyMeters != null && Number.isFinite(fix.accuracyMeters) ? `±${Math.round(fix.accuracyMeters)} m` : null;

  const base = { fix, accuracyText, trackingText, serverText };

  if (readiness.permission === LocationPermissionStatus.BLOCKED) {
    return { ...base, state: 'PERMISSION_DENIED', label: 'Permission blocked', tone: 'bad', updatedText: ageText(fix, now, true), action: 'OPEN_SETTINGS' };
  }
  if (readiness.permission === LocationPermissionStatus.DENIED) {
    return { ...base, state: 'PERMISSION_DENIED', label: 'Permission denied', tone: 'bad', updatedText: ageText(fix, now, true), action: 'REQUEST_PERMISSION' };
  }
  if (readiness.permission === LocationPermissionStatus.UNDETERMINED && !fix) {
    return { ...base, state: 'PERMISSION_REQUIRED', label: 'Permission needed', tone: 'warn', updatedText: null, action: 'REQUEST_PERMISSION' };
  }
  if (!readiness.servicesEnabled && readiness.checkedAt !== null && !(fix && isLive(fix, tracking, now, policy))) {
    return { ...base, state: 'SERVICES_OFF', label: 'Location is off', tone: 'bad', updatedText: ageText(fix, now, true), action: 'OPEN_SETTINGS' };
  }
  if (!fix) {
    const acquiring = tracking === LocationTrackingState.STARTING || tracking === LocationTrackingState.ACTIVE;
    return {
      ...base,
      state: acquiring ? 'ACQUIRING' : 'UNAVAILABLE',
      label: acquiring ? 'Getting location…' : 'No location yet',
      tone: 'warn',
      updatedText: null,
      action: acquiring ? null : 'REFRESH',
    };
  }

  const age = fixAgeMs(fix, now);
  if (isLive(fix, tracking, now, policy)) {
    return { ...base, state: 'LIVE', label: 'Live', tone: 'good', updatedText: `Updated ${describeAge(age)}`, action: null };
  }
  if (age <= policy.staleAfterMs) {
    return { ...base, state: 'RECENT', label: 'Recent', tone: 'good', updatedText: `Updated ${describeAge(age)}`, action: inEmergency ? null : 'REFRESH' };
  }
  return { ...base, state: 'STALE', label: 'Stale', tone: 'warn', updatedText: `Last updated ${describeAge(age)}`, action: inEmergency ? null : 'REFRESH' };
}

function isLive(fix: LocationFix, tracking: LocationTrackingState, now: number, policy: LocationPolicy): boolean {
  return tracking === LocationTrackingState.ACTIVE && fixAgeMs(fix, now) <= liveWindowMs(policy);
}

function ageText(fix: LocationFix | null, now: number, last: boolean): string | null {
  if (!fix) return null;
  return `${last ? 'Last updated' : 'Updated'} ${describeAge(fixAgeMs(fix, now))}`;
}
