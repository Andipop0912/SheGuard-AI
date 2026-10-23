import { pointAtDistanceAlongRoute, projectOntoRoute, routeLengthMeters } from '../domain/RouteDeviationDetector';
import { RoutePoint } from '../domain/RouteSafetySession';
import {
  MAX_ROUTE_SAMPLE_POINTS,
  MAX_SAFE_LOCATIONS_PER_CATEGORY,
  SAFE_LOCATION_CATEGORY_PLACE_TYPE,
  SAFE_LOCATION_ROUTE_CORRIDOR_METERS,
  SAMPLE_POINT_SPACING_METERS,
  SINGLE_SAMPLE_ROUTE_LENGTH_METERS,
  SafeLocation,
  SafeLocationCategory,
} from '../domain/SafeLocation';
import { NearbyPlace, RouteSafetyGoogleService } from '../native/RouteSafetyGoogleBridge';

const CATEGORIES: SafeLocationCategory[] = ['hospital', 'police', 'fire_station'];

/**
 * Picks a bounded set of points spread along the route to search around, instead of one search
 * at the midpoint (which misses either end of anything but a short route) or one search per GPS
 * update (which would blow through Places quota/battery). The number of points scales with route
 * length but never exceeds MAX_ROUTE_SAMPLE_POINTS, so a long route still costs a fixed, small
 * number of Places calls per category.
 */
export function pickRouteSamplePoints(routePolyline: RoutePoint[]): RoutePoint[] {
  if (routePolyline.length < 2) return routePolyline.slice(0, 1);

  const length = routeLengthMeters(routePolyline);
  if (length <= SINGLE_SAMPLE_ROUTE_LENGTH_METERS) {
    return [pointAtDistanceAlongRoute(routePolyline, length / 2)];
  }

  const desired = Math.ceil(length / SAMPLE_POINT_SPACING_METERS) + 1;
  const pointCount = Math.max(2, Math.min(MAX_ROUTE_SAMPLE_POINTS, desired));
  const points: RoutePoint[] = [];
  for (let i = 0; i < pointCount; i++) {
    const fraction = pointCount === 1 ? 0.5 : i / (pointCount - 1);
    points.push(pointAtDistanceAlongRoute(routePolyline, length * fraction));
  }
  return points;
}

/**
 * Finds hospitals/police/fire stations that are actually relevant to the planned route — not
 * everything in the city (Part 6/8) — by searching around a handful of representative points
 * along the route corridor, deduplicating by Google place ID, and labeling each result with both
 * how far ahead along the route it sits and how far it sits from the route itself (Part 5/7).
 */
export class SafeLocationsService {
  constructor(private readonly google: RouteSafetyGoogleService) {}

  public async findAlongRoute(
    routePolyline: RoutePoint[],
    currentLocation: RoutePoint | null,
    corridorMeters: number = SAFE_LOCATION_ROUTE_CORRIDOR_METERS
  ): Promise<SafeLocation[]> {
    if (routePolyline.length < 2) return [];

    const samplePoints = pickRouteSamplePoints(routePolyline);
    // Wide enough that adjacent sample points' search circles overlap and cover the corridor
    // between them, without re-querying the same ground from every point on a long route.
    const searchRadius = Math.max(corridorMeters * 2, 1000);

    const currentAlong = currentLocation ? projectOntoRoute(currentLocation, routePolyline)?.distanceAlongRouteMeters ?? 0 : 0;

    const results: SafeLocation[] = [];
    for (const category of CATEGORIES) {
      const byPlaceId = new Map<string, NearbyPlace>();
      for (const point of samplePoints) {
        let places: NearbyPlace[];
        try {
          places = await this.google.searchNearbyPlaces(point, searchRadius, SAFE_LOCATION_CATEGORY_PLACE_TYPE[category]);
        } catch {
          continue; // one search point's/category's failure never blocks the rest
        }
        for (const place of places) {
          if (place.placeId) byPlaceId.set(place.placeId, place);
        }
      }

      const inCorridor = Array.from(byPlaceId.values())
        .map((place) => ({ place, projection: projectOntoRoute({ latitude: place.latitude, longitude: place.longitude }, routePolyline) }))
        .filter(({ projection }) => projection !== null && projection.distanceToRouteMeters <= corridorMeters)
        .map(({ place, projection }): SafeLocation => {
          const p = projection as NonNullable<typeof projection>;
          return {
            placeId: place.placeId,
            name: place.name,
            address: place.address,
            category,
            latitude: place.latitude,
            longitude: place.longitude,
            distanceAheadMeters: Math.max(0, p.distanceAlongRouteMeters - currentAlong),
            distanceFromRouteMeters: p.distanceToRouteMeters,
          };
        })
        .sort((a, b) => a.distanceAheadMeters - b.distanceAheadMeters)
        .slice(0, MAX_SAFE_LOCATIONS_PER_CATEGORY);

      results.push(...inCorridor);
    }
    return results;
  }
}
