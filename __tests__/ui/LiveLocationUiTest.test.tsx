import React from 'react';
import '@testing-library/react-native/extend-expect';
import { NativeModules } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import { RootNavigator, navigationRef } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import { teardownActivationStoreForTesting, useActivationStore } from '../../src/activation/store/activationStore';
import { teardownEmergencyStoreForTesting, useEmergencyStore } from '../../src/emergency/store/emergencyStore';
import { useLocationStore } from '../../src/location/store/locationStore';
import {
  INITIAL_LOCATION_READINESS,
  LocationAvailability,
  LocationPermissionStatus,
  LocationReadiness,
  LocationTrackingState,
} from '../../src/location/domain/LocationState';
import { LocationFix, LocationProvider } from '../../src/location/domain/LocationFix';
import { LocationNativeModule } from '../../src/location/native/LocationNativeBridge';

jest.setTimeout(30000);

const animateToRegion = (MapView as unknown as { animateToRegionMock: jest.Mock }).animateToRegionMock;

const fix = (lat: number, lng: number, ageMs = 2_000, accuracy: number | null = 9): LocationFix => ({
  latitude: lat,
  longitude: lng,
  accuracyMeters: accuracy,
  altitudeMeters: null,
  speedMps: null,
  headingDegrees: null,
  timestamp: Date.now() - ageMs,
  provider: LocationProvider.FUSED,
  isLastKnown: false,
});

const readiness = (f: LocationFix | null, over: Partial<LocationReadiness> = {}): LocationReadiness => ({
  ...INITIAL_LOCATION_READINESS,
  availability: f ? LocationAvailability.AVAILABLE : LocationAvailability.UNAVAILABLE,
  permission: LocationPermissionStatus.GRANTED,
  servicesEnabled: true,
  fix: f,
  checkedAt: Date.now(),
  ...over,
});

describe('Phase 3E — Live Location screen (Google Maps visualization)', () => {
  const initialActivation = useActivationStore.getState();
  const initialEmergency = useEmergencyStore.getState();
  const initialLocation = useLocationStore.getState();

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    (NativeModules as Record<string, unknown>).SheGuardAppConfig = { googleMapsConfigured: true };
    animateToRegion.mockClear();
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initialActivation, true);
    useEmergencyStore.setState(initialEmergency, true);
    useLocationStore.setState(initialLocation, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownActivationStoreForTesting();
    teardownEmergencyStoreForTesting();
    delete (NativeModules as Record<string, unknown>).SheGuardAppConfig;
    jest.restoreAllMocks();
  });

  const openLiveLocation = async () => {
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
    act(() => navigationRef.navigate('LiveLocation'));
    await screen.findByTestId('live-location-screen');
  };

  test('renders the map with the latest location marker and accuracy circle, centered on it', async () => {
    useLocationStore.setState({ readiness: readiness(fix(19.0426, 73.0231)) });
    await openLiveLocation();

    expect(screen.getByTestId('live-map')).toBeTruthy();
    expect(screen.getByTestId('live-marker').props.coordinate).toEqual({ latitude: 19.0426, longitude: 73.0231 });
    expect(screen.getByTestId('live-accuracy-circle').props.radius).toBe(9);
    expect(screen.getByTestId('live-map').props.initialRegion).toMatchObject({ latitude: 19.0426, longitude: 73.0231 });
    expect(animateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: 19.0426, longitude: 73.0231 }), 400);
    expect(screen.getByTestId('live-accuracy')).toHaveTextContent('Accuracy: ±9 m');
    expect(screen.getByTestId('live-status')).toHaveTextContent('Recent'); // fresh but not tracking → not "Live"
  });

  test('a new fix moves the marker and the camera follows', async () => {
    useLocationStore.setState({ readiness: readiness(fix(19.0, 73.0)) });
    await openLiveLocation();
    animateToRegion.mockClear();

    act(() => useLocationStore.setState({ readiness: readiness(fix(19.01, 73.02, 500)) }));
    expect(screen.getByTestId('live-marker').props.coordinate).toEqual({ latitude: 19.01, longitude: 73.02 });
    expect(animateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: 19.01, longitude: 73.02 }), 400);
  });

  test('after the user pans, updates do not recenter; the recenter control does', async () => {
    useLocationStore.setState({ readiness: readiness(fix(19.0, 73.0)) });
    await openLiveLocation();
    expect(screen.queryByTestId('live-recenter')).toBeNull();

    fireEvent(screen.getByTestId('live-map'), 'panDrag');
    animateToRegion.mockClear();
    act(() => useLocationStore.setState({ readiness: readiness(fix(19.05, 73.05, 500)) }));
    expect(screen.getByTestId('live-marker').props.coordinate).toEqual({ latitude: 19.05, longitude: 73.05 });
    expect(animateToRegion).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('live-recenter'));
    expect(animateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: 19.05, longitude: 73.05 }), 400);
    expect(screen.queryByTestId('live-recenter')).toBeNull();
  });

  test('permission denied state (no marker, allow action)', async () => {
    useLocationStore.setState({ readiness: readiness(null, { permission: LocationPermissionStatus.DENIED }) });
    await openLiveLocation();
    expect(screen.getByTestId('live-status')).toHaveTextContent('Permission denied');
    expect(screen.getByTestId('live-action')).toHaveTextContent('Allow location');
    expect(screen.queryByTestId('live-marker')).toBeNull();
  });

  test('location unavailable state', async () => {
    useLocationStore.setState({ readiness: readiness(null) });
    await openLiveLocation();
    expect(screen.getByTestId('live-status')).toHaveTextContent('No location yet');
    expect(screen.getByTestId('live-accuracy')).toHaveTextContent('Accuracy: not reported');
    expect(screen.queryByTestId('live-marker')).toBeNull();
  });

  test('stale state is never shown as live', async () => {
    useLocationStore.setState({
      readiness: readiness(fix(19, 73, 10 * 60_000)),
      tracking: LocationTrackingState.ACTIVE,
    });
    await openLiveLocation();
    expect(screen.getByTestId('live-status')).toHaveTextContent('Stale');
    expect(screen.getByTestId('live-updated')).toHaveTextContent('Last updated 10 min ago');
    expect(screen.getByTestId('live-marker').props.title).toBe('You (latest known)');
  });

  test('without a Google Maps key the map is not mounted (no crash); details still shown', async () => {
    (NativeModules as Record<string, unknown>).SheGuardAppConfig = { googleMapsConfigured: false };
    useLocationStore.setState({ readiness: readiness(fix(19.0426, 73.0231)) });
    await openLiveLocation();
    expect(screen.getByTestId('live-map-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('live-map')).toBeNull();
    expect(screen.getByTestId('live-coordinates')).toHaveTextContent('19.04260, 73.02310');
  });

  test('opening/closing the screen starts no GPS, tracking or watcher, and never stops emergency tracking', async () => {
    const service = AppContainer.getInstance().locationService;
    const spies = [
      jest.spyOn(service, 'startTracking'),
      jest.spyOn(service, 'stopTracking'),
      jest.spyOn(service, 'acquireCurrentFix'),
      jest.spyOn(service, 'subscribeFixes'),
      jest.spyOn(LocationNativeModule.prototype, 'startTracking'),
      jest.spyOn(LocationNativeModule.prototype, 'getCurrentLocation'),
      jest.spyOn(LocationNativeModule.prototype, 'onLocationUpdate'),
    ];
    useLocationStore.setState({ readiness: readiness(fix(19, 73)), tracking: LocationTrackingState.ACTIVE });
    await openLiveLocation();
    act(() => navigationRef.goBack());
    await screen.findByTestId('home-unarmed');
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('emergency: banner + live state from existing tracking; Emergency location card opens the map', async () => {
    await render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    act(() => useLocationStore.setState({ readiness: readiness(fix(19.04, 73.02, 3_000)), tracking: LocationTrackingState.ACTIVE }));

    fireEvent.press(screen.getByTestId('card-location-open-map'));
    await screen.findByTestId('live-location-screen');
    expect(screen.getByTestId('live-emergency-banner')).toHaveTextContent(/Emergency active · Emergency tracking on/);
    expect(screen.getByTestId('live-status')).toHaveTextContent('Live');
    expect(screen.getByTestId('live-marker').props.title).toBe('You (live)');
  });

  test('full-screen map toggle hides details but always keeps the truthful status visible', async () => {
    useLocationStore.setState({ readiness: readiness(fix(19, 73, 10 * 60_000)) });
    await openLiveLocation();
    expect(screen.getByTestId('live-details')).toBeTruthy();
    expect(screen.queryByTestId('live-fullscreen-status')).toBeNull();

    fireEvent.press(screen.getByTestId('live-fullscreen'));
    expect(screen.queryByTestId('live-details')).toBeNull();
    expect(screen.getByTestId('live-map')).toBeTruthy();
    expect(screen.getByTestId('live-fullscreen-status')).toHaveTextContent(/Stale · Last updated 10 min ago · ±9 m/);

    fireEvent.press(screen.getByTestId('live-fullscreen'));
    expect(screen.getByTestId('live-details')).toBeTruthy();
    expect(screen.queryByTestId('live-fullscreen-status')).toBeNull();
  });

  test('no full-screen button when the map itself is unavailable', async () => {
    (NativeModules as Record<string, unknown>).SheGuardAppConfig = { googleMapsConfigured: false };
    useLocationStore.setState({ readiness: readiness(fix(19, 73)) });
    await openLiveLocation();
    expect(screen.queryByTestId('live-fullscreen')).toBeNull();
  });

  test('Home location row opens Live Location (no placeholder)', async () => {
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
    fireEvent.press(screen.getByTestId('home-location-row'));
    expect(await screen.findByTestId('live-location-screen')).toBeTruthy();
    expect(screen.queryByTestId('planned-liveLocation')).toBeNull();
  });
});
