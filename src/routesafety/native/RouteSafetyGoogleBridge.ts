import { NativeModules, Platform } from 'react-native';
import { RoutePoint } from '../domain/RouteSafetySession';

const { SheGuardRouteSafetyModule } = NativeModules;

export interface ComputedRoute {
  polyline: RoutePoint[];
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/**
 * Thin wrapper over the native Routes/Places bridge. The Google API key never reaches this
 * file or any JS code — the native module holds it (see RouteSafetyGoogleModule.kt), matching
 * this codebase's existing rule that Google API keys stay native-only (mapsConfig.ts).
 */
export class RouteSafetyGoogleService {
  private isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardRouteSafetyModule;
  }

  public async geocodeText(query: string, biasNear: RoutePoint): Promise<RoutePoint> {
    if (!this.isAvailable()) {
      throw new Error('Destination search is not available on this device');
    }
    const result = await SheGuardRouteSafetyModule.geocodeText(query, biasNear.latitude, biasNear.longitude);
    return { latitude: result.latitude, longitude: result.longitude };
  }

  public async computeRoute(origin: RoutePoint, destination: RoutePoint): Promise<ComputedRoute> {
    if (!this.isAvailable()) {
      throw new Error('Route calculation is not available on this device');
    }
    const result = await SheGuardRouteSafetyModule.computeRoute(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude
    );
    return {
      polyline: Array.isArray(result?.polyline) ? result.polyline : [],
      distanceMeters: typeof result?.distanceMeters === 'number' ? result.distanceMeters : null,
      durationSeconds: typeof result?.durationSeconds === 'number' ? result.durationSeconds : null,
    };
  }

  public async searchNearbyPlaces(center: RoutePoint, radiusMeters: number, placeType: string): Promise<NearbyPlace[]> {
    if (!this.isAvailable()) return [];
    const result = await SheGuardRouteSafetyModule.searchNearbyPlaces(center.latitude, center.longitude, radiusMeters, placeType);
    return Array.isArray(result) ? result : [];
  }
}
