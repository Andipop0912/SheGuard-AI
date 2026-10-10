/**
 * Which platform source produced a fix. Mirrors the backend LocationProvider enum.
 */
export enum LocationProvider {
  FUSED = 'FUSED',
  GPS = 'GPS',
  NETWORK = 'NETWORK',
  PASSIVE = 'PASSIVE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * A single location fix exactly as reported by the device. Never synthesized.
 */
export interface LocationFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
  readonly altitudeMeters: number | null;
  readonly speedMps: number | null;
  readonly headingDegrees: number | null;
  /** Time the device captured the fix (epoch ms). */
  readonly timestamp: number;
  readonly provider: LocationProvider;
  /** True when the platform returned a cached (last-known) fix instead of a new one. */
  readonly isLastKnown: boolean;
}

const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Validates an untyped fix coming across the native bridge. Returns null rather than
 * repairing anything: an invalid fix is treated as "no fix", never as a guessed position.
 */
export function parseLocationFix(raw: unknown): LocationFix | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const latitude = optionalNumber(r.latitude);
  const longitude = optionalNumber(r.longitude);
  const timestamp = optionalNumber(r.timestamp);
  if (latitude === null || longitude === null || timestamp === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || timestamp <= 0) return null;

  const provider = Object.values(LocationProvider).includes(r.provider as LocationProvider)
    ? (r.provider as LocationProvider)
    : LocationProvider.UNKNOWN;
  const accuracy = optionalNumber(r.accuracyMeters);
  const speed = optionalNumber(r.speedMps);
  const heading = optionalNumber(r.headingDegrees);

  return {
    latitude,
    longitude,
    accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
    altitudeMeters: optionalNumber(r.altitudeMeters),
    speedMps: speed !== null && speed >= 0 ? speed : null,
    headingDegrees: heading !== null && heading >= 0 && heading < 360 ? heading : null,
    timestamp,
    provider,
    isLastKnown: r.isLastKnown === true,
  };
}

export function fixAgeMs(fix: LocationFix, now: number): number {
  return Math.max(0, now - fix.timestamp);
}
