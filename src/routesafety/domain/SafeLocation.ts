/**
 * Corridor around the planned route within which a safe location is considered "on the route",
 * not just somewhere in the city. Configurable — never hard-coded in a UI component.
 */
export const SAFE_LOCATION_ROUTE_CORRIDOR_METERS = 500;

/** Caps map clutter (Part 8: "do not flood the map"). */
export const MAX_SAFE_LOCATIONS_PER_CATEGORY = 5;

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
  /** Distance to show the user. */
  readonly distanceMeters: number;
  /** True = `distanceMeters` is measured ahead along the route; false = straight-line fallback. */
  readonly distanceIsAlongRoute: boolean;
}
