import { PermissionsAndroid, Platform } from 'react-native';
import { LocationPermissionStatus } from '../domain/LocationState';

/**
 * While-in-use location permission only. Background ("Allow all the time") is deliberately
 * not requested in this phase.
 */
export interface LocationPermissionGateway {
  check(): Promise<LocationPermissionStatus>;
  request(): Promise<LocationPermissionStatus>;
}

export class AndroidLocationPermissionGateway implements LocationPermissionGateway {
  public async check(): Promise<LocationPermissionStatus> {
    if (Platform.OS !== 'android') return LocationPermissionStatus.DENIED;
    try {
      const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      const coarse = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
      // check() cannot tell "never asked" from "denied"; request() resolves that.
      return fine || coarse ? LocationPermissionStatus.GRANTED : LocationPermissionStatus.UNDETERMINED;
    } catch {
      return LocationPermissionStatus.DENIED;
    }
  }

  public async request(): Promise<LocationPermissionStatus> {
    if (Platform.OS !== 'android') return LocationPermissionStatus.DENIED;
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);
      const values = Object.values(results);
      // Approximate (coarse) location alone still counts: it is real, just less precise.
      if (values.includes(PermissionsAndroid.RESULTS.GRANTED)) return LocationPermissionStatus.GRANTED;
      if (values.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return LocationPermissionStatus.BLOCKED;
      return LocationPermissionStatus.DENIED;
    } catch {
      return LocationPermissionStatus.DENIED;
    }
  }
}
