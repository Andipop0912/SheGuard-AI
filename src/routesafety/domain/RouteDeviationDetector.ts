import { RouteDeviationState, RoutePoint } from './RouteSafetySession';

/**
 * How far (meters) a fix may sit from the original route before it counts as a deviation.
 * 125m sits in the brief's suggested 100-150m range: enough to absorb normal road-width/GPS
 * drift and route "snapping" differences, tight enough to still mean something when exceeded.
 */
export const ROUTE_DEVIATION_THRESHOLD_METERS = 125;

/**
 * How long a fix must stay outside the threshold before a deviation is CONFIRMED (not just
 * possible). Long enough to ride out a tunnel, a momentary GPS jump, or a brief detour around
 * an obstacle; short enough that a real deviation is still caught promptly.
 */
export const DEVIATION_CONFIRMATION_SECONDS = 45;

/** Faster to recognize "back on route" than to confirm a deviation — recovery is the safe direction. */
export const RETURN_TO_ROUTE_CONFIRMATION_SECONDS = 15;

/**
 * A fix this inaccurate cannot be trusted to judge route deviation at all; it is ignored for
 * deviation purposes (the state simply does not advance), never treated as evidence of deviation.
 */
export const MIN_ACCURACY_METERS_FOR_DEVIATION = 50;

export interface DeviationSnapshot {
  readonly state: RouteDeviationState;
  readonly since: number;
  /** Set once an alert has been sent for the current DEROUTED incident; cleared back on ON_ROUTE. */
  readonly alertSentAt: number | null;
}

export function initialDeviationSnapshot(now: number): DeviationSnapshot {
  return { state: RouteDeviationState.ON_ROUTE, since: now, alertSentAt: null };
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Equirectangular approximation: accurate to well under 1% over the short (urban) distances a route spans. */
function metersBetween(a: RoutePoint, b: RoutePoint): number {
  const latRad = toRadians((a.latitude + b.latitude) / 2);
  const dx = toRadians(b.longitude - a.longitude) * Math.cos(latRad) * EARTH_RADIUS_METERS;
  const dy = toRadians(b.latitude - a.latitude) * EARTH_RADIUS_METERS;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest distance from `point` to the segment a→b, in meters (flat local approximation). */
function distanceToSegmentMeters(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const latRad = toRadians((a.latitude + b.latitude) / 2);
  const toXY = (p: RoutePoint) => ({
    x: toRadians(p.longitude - a.longitude) * Math.cos(latRad) * EARTH_RADIUS_METERS,
    y: toRadians(p.latitude - a.latitude) * EARTH_RADIUS_METERS,
  });
  const p = toXY(point);
  const bXY = toXY(b);
  const abLenSq = bXY.x * bXY.x + bXY.y * bXY.y;
  if (abLenSq === 0) return metersBetween(point, a);

  const t = Math.max(0, Math.min(1, (p.x * bXY.x + p.y * bXY.y) / abLenSq));
  const projX = t * bXY.x;
  const projY = t * bXY.y;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/** Total length of `routePolyline`, in meters (sum of segment lengths). */
export function routeLengthMeters(routePolyline: RoutePoint[]): number {
  let total = 0;
  for (let i = 0; i < routePolyline.length - 1; i++) {
    total += metersBetween(routePolyline[i], routePolyline[i + 1]);
  }
  return total;
}

/**
 * The point on `routePolyline` at `targetMeters` along its length (clamped to the route's
 * extent). Used to pick evenly-spaced search points along a route for the safe-locations
 * corridor search, independent of how densely the polyline's own vertices are spaced.
 */
export function pointAtDistanceAlongRoute(routePolyline: RoutePoint[], targetMeters: number): RoutePoint {
  if (routePolyline.length === 0) return { latitude: 0, longitude: 0 };
  if (routePolyline.length === 1 || targetMeters <= 0) return routePolyline[0];

  let cumulative = 0;
  for (let i = 0; i < routePolyline.length - 1; i++) {
    const a = routePolyline[i];
    const b = routePolyline[i + 1];
    const segmentLength = metersBetween(a, b);
    if (cumulative + segmentLength >= targetMeters) {
      const t = segmentLength === 0 ? 0 : (targetMeters - cumulative) / segmentLength;
      return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
    }
    cumulative += segmentLength;
  }
  return routePolyline[routePolyline.length - 1];
}

/** Nearest distance from `point` to any segment of `routePolyline`, in meters. */
export function distanceToRouteMeters(point: RoutePoint, routePolyline: RoutePoint[]): number {
  if (routePolyline.length === 0) return Infinity;
  if (routePolyline.length === 1) return metersBetween(point, routePolyline[0]);

  let min = Infinity;
  for (let i = 0; i < routePolyline.length - 1; i++) {
    const d = distanceToSegmentMeters(point, routePolyline[i], routePolyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

export interface RouteProjection {
  /** Perpendicular distance from `point` to the nearest point on the route, in meters. */
  distanceToRouteMeters: number;
  /** Distance along the route (from its start) to that nearest point, in meters. */
  distanceAlongRouteMeters: number;
}

/**
 * Projects `point` onto the nearest segment of `routePolyline`, returning both how far off the
 * route it is and how far along the route that nearest point sits — used to show "X ahead along
 * route" distances (Part 7) rather than a plain straight-line distance.
 */
export function projectOntoRoute(point: RoutePoint, routePolyline: RoutePoint[]): RouteProjection | null {
  if (routePolyline.length < 2) return null;

  let best: RouteProjection | null = null;
  let cumulative = 0;
  for (let i = 0; i < routePolyline.length - 1; i++) {
    const a = routePolyline[i];
    const b = routePolyline[i + 1];
    const segmentLength = metersBetween(a, b);
    const d = distanceToSegmentMeters(point, a, b);
    if (best === null || d < best.distanceToRouteMeters) {
      const t = segmentProjectionFraction(point, a, b);
      best = { distanceToRouteMeters: d, distanceAlongRouteMeters: cumulative + t * segmentLength };
    }
    cumulative += segmentLength;
  }
  return best;
}

function segmentProjectionFraction(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const latRad = toRadians((a.latitude + b.latitude) / 2);
  const toXY = (p: RoutePoint) => ({
    x: toRadians(p.longitude - a.longitude) * Math.cos(latRad) * EARTH_RADIUS_METERS,
    y: toRadians(p.latitude - a.latitude) * EARTH_RADIUS_METERS,
  });
  const p = toXY(point);
  const bXY = toXY(b);
  const abLenSq = bXY.x * bXY.x + bXY.y * bXY.y;
  if (abLenSq === 0) return 0;
  return Math.max(0, Math.min(1, (p.x * bXY.x + p.y * bXY.y) / abLenSq));
}

export interface DeviationFix {
  readonly point: RoutePoint;
  readonly accuracyMeters: number | null;
  readonly timestamp: number;
}

export type DeviationAdvanceResult = {
  snapshot: DeviationSnapshot;
  /** True exactly once per confirmed incident: the instant to actually send an alert. */
  shouldAlertNow: boolean;
};

/**
 * Advances the deviation state machine by one fix. Never called at all when there is no fix
 * (missing location is not evidence of deviation); a fix whose accuracy is worse than
 * [MIN_ACCURACY_METERS_FOR_DEVIATION] is accepted here but leaves the state unchanged.
 */
export function advanceDeviationState(
  current: DeviationSnapshot,
  fix: DeviationFix,
  routePolyline: RoutePoint[]
): DeviationAdvanceResult {
  if (fix.accuracyMeters != null && fix.accuracyMeters > MIN_ACCURACY_METERS_FOR_DEVIATION) {
    return { snapshot: current, shouldAlertNow: false };
  }

  const distance = distanceToRouteMeters(fix.point, routePolyline);
  const onRoute = distance <= ROUTE_DEVIATION_THRESHOLD_METERS;
  const now = fix.timestamp;

  switch (current.state) {
    case RouteDeviationState.ON_ROUTE:
      if (!onRoute) {
        return { snapshot: { state: RouteDeviationState.POSSIBLE_DEVIATION, since: now, alertSentAt: null }, shouldAlertNow: false };
      }
      return { snapshot: current, shouldAlertNow: false };

    case RouteDeviationState.POSSIBLE_DEVIATION:
      if (onRoute) {
        return { snapshot: { state: RouteDeviationState.ON_ROUTE, since: now, alertSentAt: null }, shouldAlertNow: false };
      }
      if (now - current.since >= DEVIATION_CONFIRMATION_SECONDS * 1000) {
        return {
          snapshot: { state: RouteDeviationState.DEROUTED, since: now, alertSentAt: now },
          shouldAlertNow: true,
        };
      }
      return { snapshot: current, shouldAlertNow: false };

    case RouteDeviationState.DEROUTED:
      if (onRoute) {
        return { snapshot: { state: RouteDeviationState.RETURNED_TO_ROUTE, since: now, alertSentAt: current.alertSentAt }, shouldAlertNow: false };
      }
      // Still derouted: the alert for this incident was already sent once. No repeat alerts.
      return { snapshot: current, shouldAlertNow: false };

    case RouteDeviationState.RETURNED_TO_ROUTE:
      if (!onRoute) {
        // Slipped back out before fully confirming recovery: treat as a fresh possible deviation.
        return { snapshot: { state: RouteDeviationState.POSSIBLE_DEVIATION, since: now, alertSentAt: null }, shouldAlertNow: false };
      }
      if (now - current.since >= RETURN_TO_ROUTE_CONFIRMATION_SECONDS * 1000) {
        return { snapshot: { state: RouteDeviationState.ON_ROUTE, since: now, alertSentAt: null }, shouldAlertNow: false };
      }
      return { snapshot: current, shouldAlertNow: false };
  }
}
