import { projectOntoRoute } from '../domain/RouteDeviationDetector';
import { RoutePoint } from '../domain/RouteSafetySession';
import {
  MAX_SAFE_LOCATIONS_PER_CATEGORY,
  SAFE_LOCATION_CATEGORY_PLACE_TYPE,
  SAFE_LOCATION_ROUTE_CORRIDOR_METERS,
  SafeLocation,
  SafeLocationCategory,
} from '../domain/SafeLocation';
import { RouteSafetyGoogleService } from '../native/RouteSafetyGoogleBridge';

const CATEGORIES: SafeLocationCategory[] = ['hospital', 'police', 'fire_station'];

/**
 * Finds hospitals/police/fire stations that are actually relevant to the planned route — not
 * everything in the city (Part 6/8) — and labels each one's distance truthfully: ahead-along-
 * route when it can be computed, straight-line (explicitly labeled) otherwise (Part 7).
 */
export class SafeLocationsService {
  constructor(private readonly google: RouteSafetyGoogleService) {}

  public async findAlongRoute(
    routePolyline: RoutePoint[],
    currentLocation: RoutePoint | null,
    corridorMeters: number = SAFE_LOCATION_ROUTE_CORRIDOR_METERS
  ): Promise<SafeLocation[]> {
    if (routePolyline.length < 2) return [];

    // Search near the route midpoint with a radius covering the whole corridor; the client-side
    // corridor filter below is still the authority on what actually counts as "along the route".
    const mid = routePolyline[Math.floor(routePolyline.length / 2)];
    const searchRadius = Math.max(corridorMeters * 2, 1000);

    const currentAlong = currentLocation ? projectOntoRoute(currentLocation, routePolyline)?.distanceAlongRouteMeters ?? 0 : 0;

    const results: SafeLocation[] = [];
    for (const category of CATEGORIES) {
      let places;
      try {
        places = await this.google.searchNearbyPlaces(mid, searchRadius, SAFE_LOCATION_CATEGORY_PLACE_TYPE[category]);
      } catch {
        continue; // one category's failure never blocks the others
      }

      const inCorridor = places
        .map((place) => {
          const projection = projectOntoRoute({ latitude: place.latitude, longitude: place.longitude }, routePolyline);
          return { place, projection };
        })
        .filter(({ projection }) => projection !== null && projection.distanceToRouteMeters <= corridorMeters)
        .map(({ place, projection }): SafeLocation => {
          const ahead = Math.max(0, (projection as NonNullable<typeof projection>).distanceAlongRouteMeters - currentAlong);
          return {
            placeId: place.placeId,
            name: place.name,
            address: place.address,
            category,
            latitude: place.latitude,
            longitude: place.longitude,
            distanceMeters: ahead,
            distanceIsAlongRoute: true,
          };
        })
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, MAX_SAFE_LOCATIONS_PER_CATEGORY);

      results.push(...inCorridor);
    }
    return results;
  }
}
