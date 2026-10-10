/**
 * RouteSafetyScreen.tsx — Phase B
 *
 * Route Safety: a real session built on the existing location layer (locationStore /
 * LocationService) and the native Google Routes/Places bridge. No fake safety scores, no
 * fabricated route when Google cannot compute one.
 *
 * Safety architecture guarantee (unchanged from Phase 3G):
 *   - This screen never touches EmergencyCoordinator, ActivationManager, or the SOS path.
 *   - RouteSafetyController reuses the existing LocationService tracking toggle; it never
 *     starts a second GPS watcher, and never stops tracking an open emergency relies on.
 *   - Closing or failing this screen does NOT affect any emergency feature.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { useLocationStore } from '../../location/store/locationStore';
import { LocationPermissionStatus } from '../../location/domain/LocationState';
import { isGoogleMapsConfigured } from '../../config/mapsConfig';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, typography, cardShadow } from '../../design/tokens';
import { Icon, IconName } from '../../design/Icon';
import { useRouteSafetyStore } from '../../routesafety/store/routeSafetyStore';
import { AppContainer } from '../../app/di/AppContainer';
import { SafeLocation } from '../../routesafety/domain/SafeLocation';
import { RoutePoint } from '../../routesafety/domain/RouteSafetySession';

const ZOOM_DELTA = 0.012;

function buildGoogleMapsUrl(originLat: number, originLng: number, destination: string): string {
  const saddr = `${originLat},${originLng}`;
  const daddr = encodeURIComponent(destination.trim());
  return `https://www.google.com/maps/dir/?api=1&origin=${saddr}&destination=${daddr}&travelmode=walking`;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

const CATEGORY_ICON: Record<SafeLocation['category'], IconName> = {
  hospital: 'local-hospital',
  police: 'local-police',
  fire_station: 'local-fire-department',
};

export const RouteSafetyScreen: React.FC<RootStackScreenProps<'RouteSafety'>> = () => {
  const readiness = useLocationStore((s) => s.readiness);
  const refreshCurrentLocation = useLocationStore((s) => s.refreshCurrentLocation);
  const requestPermission = useLocationStore((s) => s.requestPermission);

  const session = useRouteSafetyStore((s) => s.session);
  const starting = useRouteSafetyStore((s) => s.starting);
  const startError = useRouteSafetyStore((s) => s.error);
  const startRouteSafety = useRouteSafetyStore((s) => s.start);
  const endRouteSafety = useRouteSafetyStore((s) => s.end);

  const [destination, setDestination] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [computingRoute, setComputingRoute] = useState(false);
  const [safeLocations, setSafeLocations] = useState<SafeLocation[]>([]);
  const [mapsOpenError, setMapsOpenError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const mapsConfigured = useMemo(isGoogleMapsConfigured, []);
  const fix = readiness.fix ?? null;
  const hasPermission = readiness.permission === LocationPermissionStatus.GRANTED;
  const isActive = session?.status === 'ACTIVE';

  useFocusEffect(
    useCallback(() => {
      refreshCurrentLocation().catch(() => {});
    }, [refreshCurrentLocation])
  );

  useEffect(() => {
    if (!isActive || !session) {
      setSafeLocations([]);
      return;
    }
    AppContainer.getInstance()
      .safeLocationsService.findAlongRoute(session.routePolyline, session.currentLocation)
      .then(setSafeLocations)
      .catch(() => setSafeLocations([]));
  }, [isActive, session?.sessionId, session?.routePolyline.length]);

  const locationLabel = (() => {
    if (!hasPermission) return 'Location permission required';
    if (!fix) return 'Obtaining current location…';
    const ageMs = Date.now() - fix.timestamp;
    if (ageMs < 60_000) return 'Current location active';
    if (ageMs < 300_000) return 'Recent location available';
    return 'Stale location — tap to refresh';
  })();

  const locationTone = !hasPermission ? 'bad' : !fix ? 'warn' : 'good';
  const TONE_COLOR: Record<string, string> = { good: colors.success, warn: colors.warning, bad: colors.emergencyRed };

  const onRefreshLocation = async () => {
    if (refreshing) return;
    if (!hasPermission) {
      await requestPermission();
      return;
    }
    setRefreshing(true);
    try {
      await refreshCurrentLocation();
    } finally {
      setRefreshing(false);
    }
  };

  const onOpenInGoogleMaps = async () => {
    if (!fix) return;
    const dest = destination.trim();
    if (!dest) return;
    setMapsOpenError(null);
    const url = buildGoogleMapsUrl(fix.latitude, fix.longitude, dest);
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        setMapsOpenError('Unable to open Google Maps right now. Check that it is installed.');
      }
    } catch {
      setMapsOpenError('Unable to open Google Maps right now. Check that it is installed.');
    }
  };

  const onStartRouteSafety = async () => {
    if (!fix) return;
    const dest = destination.trim();
    if (!dest) return;

    setComputingRoute(true);
    try {
      const google = AppContainer.getInstance().routeSafetyGoogleService;
      let geocoded: RoutePoint;
      try {
        geocoded = await google.geocodeText(dest, fix);
      } catch (e) {
        Alert.alert('Could not find that destination', e instanceof Error ? e.message : 'Try a more specific address or place name.');
        return;
      }
      let computed;
      try {
        computed = await google.computeRoute(fix, geocoded);
      } catch (e) {
        Alert.alert('Could not calculate a route', e instanceof Error ? e.message : 'Please try again.');
        return;
      }

      const ok = await startRouteSafety({
        startLocation: { latitude: fix.latitude, longitude: fix.longitude },
        destinationText: dest,
        destinationLocation: geocoded,
        routePolyline: computed.polyline.length > 0 ? computed.polyline : [fix, geocoded],
        routeDistanceMeters: computed.distanceMeters,
        routeDurationSeconds: computed.durationSeconds,
      });
      if (!ok) {
        Alert.alert('Could not start Route Safety', useRouteSafetyStore.getState().error ?? 'Please try again.');
      }
    } finally {
      setComputingRoute(false);
    }
  };

  const onEndRouteSafety = async () => {
    await endRouteSafety();
  };

  const deviationBadge = (() => {
    switch (session?.deviationState) {
      case 'DEROUTED':
        return { text: 'Deviation confirmed', color: colors.emergencyRed };
      case 'POSSIBLE_DEVIATION':
        return { text: 'Checking position…', color: colors.warning };
      case 'RETURNED_TO_ROUTE':
        return { text: 'Returning to route', color: colors.warning };
      default:
        return { text: 'On route', color: colors.success };
    }
  })();

  const canStart = !!fix && destination.trim().length > 0 && !isActive;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="route-safety-screen">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.mapArea}>
            {mapsConfigured ? (
              <MapView
                style={StyleSheet.absoluteFill}
                provider={PROVIDER_GOOGLE}
                initialRegion={
                  fix ? { latitude: fix.latitude, longitude: fix.longitude, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA } : undefined
                }
                showsUserLocation={false}
                showsMyLocationButton={false}
                toolbarEnabled={false}
                testID="route-map"
              >
                {fix && <Marker coordinate={{ latitude: fix.latitude, longitude: fix.longitude }} title="Your location" pinColor={colors.primaryNavy} testID="route-origin-marker" />}
                {session?.destinationLocation && (
                  <Marker coordinate={session.destinationLocation} title="Destination" pinColor={colors.emergencyRed} testID="route-destination-marker" />
                )}
                {session && session.routePolyline.length > 1 && (
                  <Polyline coordinates={session.routePolyline} strokeColor={colors.primaryNavy} strokeWidth={4} testID="route-polyline" />
                )}
                {safeLocations.map((loc) => (
                  <Marker
                    key={loc.placeId}
                    coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
                    title={loc.name}
                    description={`${formatDistance(loc.distanceMeters)} ${loc.distanceIsAlongRoute ? 'ahead' : 'away (straight-line)'}`}
                    pinColor={colors.infoBlue}
                  />
                ))}
              </MapView>
            ) : (
              <View style={styles.mapUnavailable} testID="route-map-unavailable">
                <Icon name="map" size={36} color={colors.textMuted} />
                <Text style={styles.mapUnavailableTitle}>Map not available in this build</Text>
                <Text style={styles.mapUnavailableBody}>A Google Maps key is not configured. Route planning via Google Maps is still available below.</Text>
              </View>
            )}
          </View>

          <View style={styles.panel}>
            <Pressable style={styles.locationCard} onPress={onRefreshLocation} testID="route-location-card" accessibilityRole="button" accessibilityLabel="Refresh current location">
              <View style={styles.locationLeft}>
                <View style={[styles.dot, { backgroundColor: TONE_COLOR[locationTone] ?? colors.textMuted }]} />
                <View style={styles.locationTextCol}>
                  <Text style={styles.cardLabel}>Current Location</Text>
                  <Text style={styles.locationValue} testID="route-location-label">{locationLabel}</Text>
                  {fix && <Text style={styles.coordsText} testID="route-coords">{fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}</Text>}
                </View>
              </View>
              {refreshing ? <ActivityIndicator size="small" color={colors.primaryNavy} /> : <Icon name="my-location" size={20} color={colors.textSecondary} />}
            </Pressable>

            {!isActive && (
              <View style={styles.destCard} testID="route-destination-card">
                <Icon name="edit-location" size={20} color={colors.primaryNavy} />
                <View style={styles.destTextCol}>
                  <Text style={styles.cardLabel}>Destination</Text>
                  <TextInput
                    ref={inputRef}
                    style={styles.destInput}
                    value={destination}
                    onChangeText={setDestination}
                    placeholder="Enter destination address or place"
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    testID="route-destination-input"
                    accessibilityLabel="Destination"
                  />
                </View>
              </View>
            )}

            {(startError || mapsOpenError) && !isActive && (
              <View style={styles.statusBanner} testID="route-status-message">
                <Icon name="info-outline" size={16} color={colors.warning} />
                <Text style={styles.statusText}>{startError ?? mapsOpenError}</Text>
              </View>
            )}

            {!isActive ? (
              <>
                <Pressable
                  style={({ pressed }) => [styles.navButton, !canStart && styles.navButtonDisabled, pressed && canStart ? styles.pressed : null]}
                  onPress={onStartRouteSafety}
                  disabled={!canStart || computingRoute || starting}
                  testID="route-start-safety"
                  accessibilityRole="button"
                  accessibilityLabel="Start Route Safety"
                >
                  {computingRoute || starting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Icon name="shield" size={18} color={colors.white} />
                      <Text style={styles.navButtonText}>Start Route Safety</Text>
                    </>
                  )}
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={onOpenInGoogleMaps} disabled={!fix || !destination.trim()} testID="route-open-navigation">
                  <Icon name="navigation" size={16} color={colors.primaryNavy} />
                  <Text style={styles.secondaryButtonText}>Open in Google Maps instead</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.summaryCard} testID="route-active-card">
                <View style={styles.summaryRow}>
                  <Icon name="flag" size={16} color={colors.textSecondary} />
                  <Text style={styles.summaryLabel}>Destination</Text>
                  <Text style={styles.summaryValueMuted}>{session?.destinationText}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Icon name="shield" size={16} color={colors.textSecondary} />
                  <Text style={styles.summaryLabel}>Status</Text>
                  <Text style={[styles.summaryValue, { color: deviationBadge.color }]} testID="route-deviation-status">{deviationBadge.text}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Icon name="people-alt" size={16} color={colors.textSecondary} />
                  <Text style={styles.summaryLabel}>Trusted contacts</Text>
                  <Text style={styles.summaryValueMuted}>{session?.startNotificationSent ? 'Notified' : 'Notifying…'}</Text>
                </View>
                {safeLocations.length > 0 && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.cardLabel}>Nearby safe locations</Text>
                    {safeLocations.slice(0, 6).map((loc) => (
                      <View key={loc.placeId} style={styles.safeLocationRow} testID={`route-safe-location-${loc.category}`}>
                        <Icon name={CATEGORY_ICON[loc.category]} size={16} color={colors.infoBlue} />
                        <Text style={styles.safeLocationName} numberOfLines={1}>{loc.name}</Text>
                        <Text style={styles.safeLocationDistance}>
                          {formatDistance(loc.distanceMeters)} {loc.distanceIsAlongRoute ? 'ahead' : '(straight-line)'}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
                <Pressable style={styles.endButton} onPress={onEndRouteSafety} testID="route-end-safety" accessibilityRole="button" accessibilityLabel="End Route Safety">
                  <Icon name="close" size={16} color={colors.emergencyRed} />
                  <Text style={styles.endButtonText}>End Route Safety</Text>
                </Pressable>
                <Text style={styles.safetyNote}>SOS, voice and shake protection work independently at all times.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  mapArea: { height: 220, backgroundColor: colors.surfaceSecondary },
  mapUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenHorizontal },
  mapUnavailableTitle: { ...typography.cardTitle, color: colors.textPrimary, marginTop: 10, textAlign: 'center' },
  mapUnavailableBody: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  panel: { padding: spacing.screenHorizontal, gap: 12 },
  locationCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14, ...cardShadow,
  },
  locationLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: 12 },
  locationTextCol: { flex: 1 },
  cardLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  locationValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  coordsText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  destCard: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14, ...cardShadow,
  },
  destTextCol: { flex: 1, marginLeft: 12 },
  destInput: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, paddingVertical: 0, marginTop: 4, minHeight: 28 },
  statusBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.warningLight, borderRadius: radii.tile, paddingHorizontal: 14, paddingVertical: 10 },
  statusText: { ...typography.caption, color: colors.warningDark, flex: 1, lineHeight: 18 },
  navButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primaryNavy, borderRadius: radii.pill, height: 52 },
  navButtonDisabled: { backgroundColor: colors.textMuted },
  navButtonText: { fontSize: 16, fontWeight: '700', color: colors.white },
  pressed: { opacity: 0.85 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  secondaryButtonText: { fontSize: 13, fontWeight: '600', color: colors.primaryNavy },
  summaryCard: { backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, ...cardShadow },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  summaryLabel: { flex: 1, ...typography.body, color: colors.textSecondary },
  summaryValue: { ...typography.body, fontWeight: '700' },
  summaryValueMuted: { ...typography.body, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: -16 },
  safeLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  safeLocationName: { flex: 1, ...typography.caption, color: colors.textPrimary },
  safeLocationDistance: { ...typography.caption, color: colors.textMuted },
  endButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10 },
  endButtonText: { fontSize: 14, fontWeight: '700', color: colors.emergencyRed },
  safetyNote: { fontSize: 12, fontWeight: '400', color: colors.textMuted, marginTop: 12, lineHeight: 17 },
});
