/**
 * Location sampling and freshness policy. Every timing used by the location layer lives here.
 */
export interface LocationPolicy {
  /** A fix older than this is STALE. */
  readonly staleAfterMs: number;
  /** Max wait for a new fix when one is explicitly requested (never blocks an emergency). */
  readonly currentFixTimeoutMs: number;
  /** Emergency tracking: desired interval between updates. */
  readonly emergencyUpdateIntervalMs: number;
  /**
   * Emergency tracking: minimum movement before an update is delivered. On Android this is an
   * ADDITIONAL filter on top of the interval (not "interval OR distance"), so any value > 0
   * would silence updates while the person is stationary and make her location look stale.
   */
  readonly emergencyMinDistanceMeters: number;
  /** Local cap per emergency (matches the backend cap). */
  readonly maxPointsPerEmergency: number;
  /** Points per upload request (backend max is 100). */
  readonly syncBatchSize: number;
  /** Retry backoff for retryable sync failures. */
  readonly syncRetryInitialMs: number;
  readonly syncRetryMaxMs: number;
}

export const locationPolicy: LocationPolicy = {
  staleAfterMs: 2 * 60 * 1000,
  currentFixTimeoutMs: 15 * 1000,
  emergencyUpdateIntervalMs: 15 * 1000,
  emergencyMinDistanceMeters: 0,
  maxPointsPerEmergency: 2000,
  syncBatchSize: 50,
  syncRetryInitialMs: 2 * 1000,
  syncRetryMaxMs: 60 * 1000,
};
