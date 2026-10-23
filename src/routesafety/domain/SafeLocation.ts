/**
 * Corridor around the planned route within which a safe location is considered "on the route",
 * not just somewhere in the city. Configurable — never hard-coded in a UI component.
 */
export const SAFE_LOCATION_ROUTE_CORRIDOR_METERS = 500;

/** Caps map clutter (Part 8: "do not flood the map"). */
export const MAX_SAFE_LOCATIONS_PER_CATEGORY = 5;

/**
 * Bounds how many search points are placed along the route corridor. Protects Google Places
 * quota/latency/battery on long routes: a 40km route still does at most this many searches per
 * category, not one per kilometer.
 */
export const MAX_ROUTE_SAMPLE_POINTS = 5;

/** Below this route length, a single midpoint search already covers the whole corridor. */
export const SINGLE_SAMPLE_ROUTE_LENGTH_METERS = 2_000;

/** One search point roughly every this many meters of route, up to MAX_ROUTE_SAMPLE_POINTS. */
export const SAMPLE_POINT_SPACING_METERS = 3_000;

export type SafeLocationCategory = 'hospital' | 'police' | 'fire_station';

/** The exact Google Places (New) `includedTypes` value for each category we support. */
export const SAFE_LOCATION_CATEGORY_PLACE_TYPE: Record<SafeLocationCategory, string> = {
  hospital: 'hospital',
  police: 'police',
  fire_station: 'fire_station',
};

export interface SafeLocation {
  readonly placeId: string;
  readonly name: string;
  readonly address: string;
  readonly category: SafeLocationCategory;
  readonly latitude: number;
  readonly longitude: number;
  /** How far ahead along the planned route this location sits (never behind: clamped to 0). */
  readonly distanceAheadMeters: number;
  /** Perpendicular distance from the route corridor to this location. */
  readonly distanceFromRouteMeters: number;
}
