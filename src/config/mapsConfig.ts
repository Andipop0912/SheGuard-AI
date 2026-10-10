import { NativeModules } from 'react-native';

/**
 * Whether this build has a Google Maps SDK key. The key itself never reaches JavaScript: it is
 * injected into the Android manifest at build time (local.properties MAPS_API_KEY, git-ignored).
 * Without a key the Maps SDK aborts when a map is created, so the map must not be mounted.
 */
export function isGoogleMapsConfigured(): boolean {
  return NativeModules.SheGuardAppConfig?.googleMapsConfigured === true;
}
