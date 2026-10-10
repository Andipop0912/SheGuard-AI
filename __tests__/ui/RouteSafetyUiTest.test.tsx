/**
 * RouteSafetyUiTest.test.tsx — Phase 3G
 *
 * Tests for the Route Safety screen.
 * Tests verify: rendering, destination input, route state changes,
 * no-location behavior, Open Navigation action, and SOS regression.
 */
import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator, navigationRef } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import {
  teardownActivationStoreForTesting,
  useActivationStore,
} from '../../src/activation/store/activationStore';
import {
  teardownEmergencyStoreForTesting,
  useEmergencyStore,
} from '../../src/emergency/store/emergencyStore';
import { useLocationStore } from '../../src/location/store/locationStore';
import { LocationProvider } from '../../src/location/domain/LocationFix';
import { INITIAL_LOCATION_READINESS, LocationPermissionStatus } from '../../src/location/domain/LocationState';

jest.setTimeout(30000);

/** A real LocationFix for tests that need a location. */
const FAKE_FIX = {
  latitude: 19.076,
  longitude: 72.8777,
  accuracyMeters: 10,
  altitudeMeters: null,
  speedMps: null,
  headingDegrees: null,
  timestamp: Date.now(),
  provider: LocationProvider.FUSED,
  isLastKnown: false,
};

describe('Phase 3G — Route Safety', () => {
  const initial = {
    activation: useActivationStore.getState(),
    emergency: useEmergencyStore.getState(),
  };

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.clearAllMocks();
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initial.activation, true);
    useEmergencyStore.setState(initial.emergency, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownActivationStoreForTesting();
    teardownEmergencyStoreForTesting();
    jest.restoreAllMocks();
  });

  /** Render the full app and wait for the Home screen. */
  const renderApp = async () => {
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
  };

  /** Navigate to Route Safety from the Home NavCard. */
  const openRouteSafety = async () => {
    fireEvent.press(screen.getByTestId('home-route-safety'));
    await screen.findByTestId('route-safety-screen');
  };

  // --------------------------------------------------------------------------
  // 1. Screen renders
  // --------------------------------------------------------------------------
  test('1. Route Safety NavCard is present on the Home screen', async () => {
    await renderApp();
    expect(screen.getByTestId('home-route-safety')).toBeTruthy();
  });

  test('2. Pressing Route Safety NavCard opens the Route Safety screen', async () => {
    await renderApp();
    await openRouteSafety();
    expect(screen.getByTestId('route-safety-screen')).toBeTruthy();
  });

  test('3. Screen renders destination input', async () => {
    await renderApp();
    await openRouteSafety();
    expect(screen.getByTestId('route-destination-input')).toBeTruthy();
  });

  test('4. Destination and location cards are rendered before a Route Safety session starts', async () => {
    await renderApp();
    await openRouteSafety();
    expect(screen.getByTestId('route-destination-card')).toBeTruthy();
    expect(screen.getByTestId('route-location-card')).toBeTruthy();
    // No active-session summary (and no fabricated status) until a session actually starts.
    expect(screen.queryByTestId('route-active-card')).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 2. Destination input
  // --------------------------------------------------------------------------
  test('5. Entering a destination updates the input', async () => {
    await renderApp();
    await openRouteSafety();
    fireEvent.changeText(screen.getByTestId('route-destination-input'), 'Bandra Station, Mumbai');
    expect(screen.getByTestId('route-destination-input').props.value).toBe('Bandra Station, Mumbai');
  });

  // --------------------------------------------------------------------------
  // 3. No location available
  // --------------------------------------------------------------------------
  test('6. Open Navigation button is disabled when no location fix is available', async () => {
    // No fix in the default store state.
    await renderApp();
    await openRouteSafety();
    fireEvent.changeText(screen.getByTestId('route-destination-input'), 'Andheri West');
    // Button should be disabled (no fix).
    const btn = screen.getByTestId('route-open-navigation');
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeTruthy();
  });

  test('7. When no location, location label reflects the unavailable state', async () => {
    await renderApp();
    await openRouteSafety();
    // permissionStatus defaults to DENIED or NOT_REQUESTED in test environment → no fix.
    const label = screen.getByTestId('route-location-label');
    // It should show something about needing location, not fabricated coords.
    expect(label.props.children).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 4. With location — Open Navigation
  // --------------------------------------------------------------------------
  test('8. Open Navigation button opens the correct Google Maps URL when location is available', async () => {
    // Inject a real fix into locationStore before rendering.
    useLocationStore.setState({
      readiness: {
        ...INITIAL_LOCATION_READINESS,
        permission: LocationPermissionStatus.GRANTED,
        fix: FAKE_FIX,
      },
    });

    await renderApp();
    await openRouteSafety();

    fireEvent.changeText(screen.getByTestId('route-destination-input'), 'Gateway of India');

    await act(async () => {
      fireEvent.press(screen.getByTestId('route-open-navigation'));
    });

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const calledUrl: string = (Linking.openURL as jest.Mock).mock.calls[0][0];
    expect(calledUrl).toContain('google.com/maps');
    expect(calledUrl).toContain('19.076');
    expect(calledUrl).toContain('72.8777');
    expect(calledUrl).toContain('Gateway%20of%20India');
  });

  // --------------------------------------------------------------------------
  // 5. Route failure (canOpenURL returns false)
  // --------------------------------------------------------------------------
  test('9. Error state shown when Google Maps cannot be opened', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

    useLocationStore.setState({
      readiness: {
        ...INITIAL_LOCATION_READINESS,
        permission: LocationPermissionStatus.GRANTED,
        fix: FAKE_FIX,
      },
    });

    await renderApp();
    await openRouteSafety();

    fireEvent.changeText(screen.getByTestId('route-destination-input'), 'Juhu Beach');

    await act(async () => {
      fireEvent.press(screen.getByTestId('route-open-navigation'));
    });

    expect(screen.getByTestId('route-status-message')).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 6. No fake route data
  // --------------------------------------------------------------------------
  test('10. Screen never displays fabricated distance, ETA, or AI safety scores', async () => {
    await renderApp();
    await openRouteSafety();
    // These strings must NOT appear anywhere on the screen.
    expect(screen.queryByText(/\d+ km/i)).toBeNull();
    expect(screen.queryByText(/ETA/i)).toBeNull();
    expect(screen.queryByText(/safety score/i)).toBeNull();
    expect(screen.queryByText(/risk/i)).toBeNull();
    expect(screen.queryByText(/crime/i)).toBeNull();
    expect(screen.queryByText(/AI risk/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 7. SOS regression — Route Safety must not interfere with SOS
  // --------------------------------------------------------------------------
  test('11. Manual SOS still works immediately after visiting Route Safety', async () => {
    await renderApp();
    await openRouteSafety();

    // Go back to Home.
    act(() => navigationRef.goBack());
    await screen.findByTestId('home-unarmed');

    // Trigger SOS.
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });

    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();

    // Resolve the emergency.
    fireEvent.press(screen.getByTestId('emergency-resolve'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-resolve-confirm'));
    });
    expect(await screen.findByTestId('home-unarmed')).toBeTruthy();
  });
});
