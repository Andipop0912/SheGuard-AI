import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useLocationStore } from '../../location/store/locationStore';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { locationPolicy } from '../../config/locationPolicy';
import { isGoogleMapsConfigured } from '../../config/mapsConfig';
import { LiveTone, presentLiveLocation } from '../../location/live/liveLocationPresentation';
import { LocationFix } from '../../location/domain/LocationFix';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Icon } from '../../design/Icon';

/** Street-level zoom (~ a few hundred metres across). */
const ZOOM_DELTA = 0.005;

function regionFor(fix: LocationFix): Region {
  return { latitude: fix.latitude, longitude: fix.longitude, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA };
}

const TONE_COLOR: Record<LiveTone, string> = {
  good: colors.success,
  warn: colors.warning,
  bad: colors.emergencyRed,
  off: colors.textMuted,
};

/**
 * Live Location: a VISUALIZATION of the existing location layer (LocationService via
 * locationStore). It never starts GPS, tracking or a foreground service; during an emergency the
 * existing EmergencyLocationController keeps tracking with or without this screen.
 */
export const LiveLocationScreen: React.FC<RootStackScreenProps<'LiveLocation'>> = ({ navigation }) => {
  const readiness = useLocationStore((s) => s.readiness);
  const tracking = useLocationStore((s) => s.tracking);
  const emergencyLocation = useLocationStore((s) => s.emergencyLocation);
  const sync = useLocationStore((s) => s.sync);
  const requestPermission = useLocationStore((s) => s.requestPermission);
  const refreshCurrentLocation = useLocationStore((s) => s.refreshCurrentLocation);
  const currentEvent = useEmergencyStore((s) => s.currentEvent);
  const openEmergencyId = currentEvent && isOpenEmergencyState(currentEvent.state) ? currentEvent.eventId : null;

  const mapsConfigured = useMemo(isGoogleMapsConfigured, []);
  const mapRef = useRef<MapView | null>(null);
  const [userMovedCamera, setUserMovedCamera] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fullScreen, setFullScreen] = useState(false);

  // Full-screen map: hide the header; the details panel is hidden below.
  useEffect(() => {
    navigation.setOptions({ headerShown: !fullScreen });
  }, [fullScreen, navigation]);

  // UI clock for "Updated … ago" only (not a location poll); runs while the screen is focused.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }, [])
  );

  const presented = presentLiveLocation({
    readiness,
    tracking,
    emergencyLocation,
    openEmergencyId,
    sync,
    now,
    policy: locationPolicy,
  });
  const fix = presented.fix;

  // Follow the newest fix until the user moves the map themselves.
  const lastCenteredFix = useRef<LocationFix | null>(null);
  useEffect(() => {
    if (!fix || userMovedCamera || !mapRef.current) return;
    if (lastCenteredFix.current === fix) return;
    lastCenteredFix.current = fix;
    mapRef.current.animateToRegion(regionFor(fix), 400);
  }, [fix, userMovedCamera]);

  const recenter = () => {
    if (!fix) return;
    setUserMovedCamera(false);
    lastCenteredFix.current = fix;
    mapRef.current?.animateToRegion(regionFor(fix), 400);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCurrentLocation(); // one-shot request through the existing LocationService
    } finally {
      setRefreshing(false);
    }
  };

  const onAction = () => {
    if (presented.action === 'REQUEST_PERMISSION') requestPermission();
    else if (presented.action === 'OPEN_SETTINGS') Linking.openSettings().catch(() => undefined);
    else if (presented.action === 'REFRESH') onRefresh();
  };

  const actionLabel =
    presented.action === 'REQUEST_PERMISSION'
      ? 'Allow location'
      : presented.action === 'OPEN_SETTINGS'
        ? 'Open settings'
        : presented.action === 'REFRESH'
          ? 'Refresh location'
          : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="live-location-screen">
      {openEmergencyId && (
        <View style={styles.emergencyBanner} testID="live-emergency-banner">
          <Icon name="crisis-alert" size={18} color={colors.white} />
          <Text style={styles.emergencyText}>Emergency active · {presented.trackingText}</Text>
        </View>
      )}

      <View style={[styles.mapArea, fullScreen && styles.mapAreaFull]}>
        {mapsConfigured ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            initialRegion={fix ? regionFor(fix) : undefined}
            onPanDrag={() => setUserMovedCamera(true)}
            showsUserLocation={false}
            showsMyLocationButton={false}
            toolbarEnabled={false}
            testID="live-map"
          >
            {fix && (
              <>
                {presented.accuracyText && fix.accuracyMeters != null && (
                  <Circle
                    center={{ latitude: fix.latitude, longitude: fix.longitude }}
                    radius={fix.accuracyMeters}
                    strokeColor="rgba(37,99,235,0.6)"
                    fillColor="rgba(37,99,235,0.15)"
                    testID="live-accuracy-circle"
                  />
                )}
                <Marker
                  coordinate={{ latitude: fix.latitude, longitude: fix.longitude }}
                  title={presented.state === 'LIVE' ? 'You (live)' : 'You (latest known)'}
                  pinColor={presented.state === 'LIVE' ? colors.emergencyRed : colors.textSecondary}
                  testID="live-marker"
                />
              </>
            )}
          </MapView>
        ) : (
          <View style={styles.mapUnavailable} testID="live-map-unavailable">
            <Icon name="location-off" size={32} color={colors.textMuted} />
            <Text style={styles.mapUnavailableTitle}>Map not available in this build</Text>
            <Text style={styles.mapUnavailableBody}>
              A Google Maps key is not configured. Your location details are still shown below.
            </Text>
          </View>
        )}

        {mapsConfigured && (
          <Pressable
            style={styles.fullScreenButton}
            onPress={() => setFullScreen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={fullScreen ? 'Exit full-screen map' : 'Open full-screen map'}
            testID="live-fullscreen"
          >
            <Icon name={fullScreen ? 'fullscreen-exit' : 'fullscreen'} size={24} color={colors.primaryNavy} />
          </Pressable>
        )}

        {fullScreen && (
          <View style={styles.fullScreenStatus} testID="live-fullscreen-status">
            <View style={[styles.dot, { backgroundColor: TONE_COLOR[presented.tone] }]} />
            <Text style={styles.fullScreenStatusText}>
              {presented.label}
              {presented.updatedText ? ` · ${presented.updatedText}` : ''}
              {presented.accuracyText ? ` · ${presented.accuracyText}` : ''}
            </Text>
          </View>
        )}

        {mapsConfigured && fix && userMovedCamera && (
          <Pressable style={styles.recenter} onPress={recenter} accessibilityLabel="Center on my location" testID="live-recenter">
            <Icon name="location-on" size={22} color={colors.primaryNavy} />
          </Pressable>
        )}
      </View>

      {!fullScreen && (
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} testID="live-details">
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: TONE_COLOR[presented.tone] }]} />
          <Text style={styles.statusLabel} testID="live-status">
            {presented.label}
          </Text>
          {presented.updatedText && (
            <Text style={styles.updated} testID="live-updated">
              {presented.updatedText}
            </Text>
          )}
        </View>

        {fix && (
          <Text style={styles.coords} testID="live-coordinates">
            {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}
          </Text>
        )}
        <Text style={styles.detail} testID="live-accuracy">
          Accuracy: {presented.accuracyText ?? 'not reported'}
        </Text>
        {presented.trackingText && (
          <Text style={styles.detail} testID="live-tracking">
            {presented.trackingText}
          </Text>
        )}
        {presented.serverText && (
          <Text style={styles.detail} testID="live-server">
            {presented.serverText}
          </Text>
        )}
        {!openEmergencyId && (
          <Text style={styles.note}>
            Continuous tracking runs during an emergency. Otherwise this shows the latest location the phone reported.
          </Text>
        )}

        {actionLabel && (
          <Pressable
            style={({ pressed }) => [styles.action, (pressed || refreshing) && styles.pressed]}
            onPress={onAction}
            disabled={refreshing}
            accessibilityRole="button"
            testID="live-action"
          >
            {refreshing ? <ActivityIndicator color={colors.white} /> : <Text style={styles.actionText}>{actionLabel}</Text>}
          </Pressable>
        )}
      </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.emergencyRed,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: 10,
  },
  emergencyText: { ...typography.body, fontWeight: '700', color: colors.white, flex: 1 },
  mapArea: { flex: 1.3, backgroundColor: colors.surfaceSecondary },
  mapAreaFull: { flex: 1 },
  fullScreenButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fullScreenStatus: {
    position: 'absolute',
    left: 16,
    top: 16,
    right: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 4,
  },
  fullScreenStatusText: { ...typography.caption, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  mapUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenHorizontal },
  mapUnavailableTitle: { ...typography.cardTitle, color: colors.textPrimary, marginTop: 10, textAlign: 'center' },
  mapUnavailableBody: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  recenter: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  panel: { flex: 1 },
  panelContent: { padding: spacing.screenHorizontal },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { ...typography.cardTitle, color: colors.textPrimary },
  updated: { ...typography.cardSubtitle, color: colors.textSecondary, marginLeft: 'auto' },
  coords: { ...typography.body, color: colors.textPrimary, marginTop: 10 },
  detail: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6 },
  note: { ...typography.caption, color: colors.textMuted, marginTop: 12, lineHeight: 17 },
  action: {
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  pressed: { opacity: 0.8 },
  actionText: { ...typography.button, color: colors.white },
});
