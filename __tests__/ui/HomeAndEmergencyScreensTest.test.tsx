import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
import { useVoiceStore } from '../../src/voice/store/voiceStore';
import { useLocationStore } from '../../src/location/store/locationStore';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';
import { VoiceDetectionState } from '../../src/voice/domain/VoiceDetectionState';
import {
  EmergencyLocationStatus,
  INITIAL_LOCATION_READINESS,
  LocationAvailability,
  LocationTrackingState,
} from '../../src/location/domain/LocationState';
import { LocationProvider } from '../../src/location/domain/LocationFix';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState, isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';

/**
 * Home + Emergency rendered through the real navigator, over the real ActivationManager,
 * shake adapter and EmergencyCoordinator (AppContainer). Voice and location are native-backed,
 * so their stores are set directly to the states the native services report.
 */
jest.setTimeout(30000);

describe('Phase 3A/3B — navigation, Home and Emergency', () => {
  const initialActivation = useActivationStore.getState();
  const initialEmergency = useEmergencyStore.getState();
  const initialVoice = useVoiceStore.getState();
  const initialLocation = useLocationStore.getState();

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => { });
    jest.spyOn(console, 'info').mockImplementation(() => { });
    jest.spyOn(console, 'log').mockImplementation(() => { });
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initialActivation, true);
    useEmergencyStore.setState(initialEmergency, true);
    useVoiceStore.setState(initialVoice, true);
    useLocationStore.setState(initialLocation, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownActivationStoreForTesting();
    teardownEmergencyStoreForTesting();
    jest.restoreAllMocks();
  });

  const container = () => AppContainer.getInstance();
  const events = () => container().emergencyRepository.getAllEvents();

  const renderApp = async () => {
    const utils = render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
    return utils;
  };

  const rowText = (testID: string) =>
    screen
      .getByTestId(testID)
      .findAll(() => true)
      .map((n: { props: { children?: unknown } }) => (typeof n.props.children === 'string' ? n.props.children : ''))
      .join('|');

  // ---------- navigation ----------

  test('navigation: Home is the initial tab; tabs, Settings → Diagnostics and planned screens are reachable', async () => {
    await renderApp();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByText('Legal Help')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();

    act(() => { navigationRef.navigate('MainTabs', { screen: 'History' }); });
    expect(await screen.findByTestId('history-empty')).toBeTruthy();

    act(() => { navigationRef.navigate('MainTabs', { screen: 'Settings' }); });
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-diagnostics'));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Diagnostics'));

    act(() => navigationRef.navigate('MainTabs', { screen: 'Home' }));
    await screen.findByTestId('home-unarmed');
    fireEvent.press(screen.getByTestId('home-ask'));
    await waitFor(() => expect(screen.getByTestId('ask-sheguard-screen')).toBeTruthy());
  });

  // ---------- Home rendering + protection state ----------

  test('Home (unarmed) renders SOS, Protection Mode card and truthful statuses', async () => {
    await renderApp();
    expect(screen.getByTestId('home-sos')).toBeTruthy();
    expect(screen.getAllByText('Protection Mode').length).toBeGreaterThan(0);
    expect(screen.getByText('Turn on to enable shake detection')).toBeTruthy();
    expect(screen.getByTestId('protection-toggle').props.value).toBe(false);
    expect(rowText('status-protection')).toContain('Inactive');
    expect(rowText('status-shake')).toContain('Disabled');
    expect(rowText('status-voice')).toContain('Off');
    expect(screen.queryByTestId('armed-banner')).toBeNull();
  });

  test('Protection toggle ON arms through ActivationManager (shake enabled); Disarm turns it off', async () => {
    await renderApp();
    const handle = jest.spyOn(container().activationManager, 'handleActivation');

    await act(async () => {
      fireEvent(screen.getByTestId('protection-toggle'), 'valueChange', true);
    });

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ source: ActivationSource.IN_APP, userInitiated: true }));
    expect(container().activationManager.getActivationState()).toBe(ActivationState.ACTIVE);
    expect(await screen.findByTestId('home-armed')).toBeTruthy();
    expect(screen.getByTestId('armed-banner')).toBeTruthy();
    expect(screen.getByText('Protection Mode Active')).toBeTruthy();
    expect(rowText('status-protection')).toContain('Active');
    expect(rowText('status-shake')).toContain('Enabled');
    expect(container().gestureActivationSource.getIsListening()).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-disarm'));
    });

    expect(container().activationManager.getActivationState()).toBe(ActivationState.INACTIVE);
    expect(await screen.findByTestId('home-unarmed')).toBeTruthy();
    expect(rowText('status-shake')).toContain('Disabled');
    expect(container().gestureActivationSource.getIsListening()).toBe(false);
  });

  test('ARM state set elsewhere (not via the toggle) is reflected on Home', async () => {
    await renderApp();
    await act(async () => {
      container().mockActivationSource.simulateActivation(true);
      await Promise.resolve();
    });
    expect(await screen.findByTestId('home-armed')).toBeTruthy();
    expect(screen.getByTestId('protection-toggle').props.value).toBe(true);
  });

  // ---------- voice / shake / location display ----------

  test('Voice display follows the voice service state (ARM independent)', async () => {
    await renderApp();
    act(() => useVoiceStore.setState({ voiceState: VoiceDetectionState.LISTENING }));
    expect(rowText('status-voice')).toContain('Listening');
    act(() => useVoiceStore.setState({ voiceState: VoiceDetectionState.ERROR }));
    expect(rowText('status-voice')).toContain('Unavailable');
  });

  test('Shake display is driven by the real detector state, not by the toggle alone', async () => {
    await renderApp();
    await act(async () => {
      fireEvent(screen.getByTestId('protection-toggle'), 'valueChange', true);
    });
    expect(rowText('status-shake')).toContain('Enabled');
    expect(screen.getByText("Shake detection enabled")).toBeTruthy();
  });

  test('Location row shows the LocationService readiness', async () => {
    await renderApp();
    expect(rowText('home-location-row')).toContain('Unavailable');
    act(() =>
      useLocationStore.setState({
        readiness: { ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.AVAILABLE },
      })
    );
    expect(rowText('home-location-row')).toContain('Ready');
    act(() =>
      useLocationStore.setState({
        readiness: { ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.PERMISSION_DENIED },
      })
    );
    expect(rowText('home-location-row')).toContain('Permission denied');
  });

  // ---------- manual SOS ----------

  test('Manual SOS (disarmed) creates one MANUAL_SOS emergency via the coordinator and presents Emergency', async () => {
    await renderApp();
    const trigger = jest.spyOn(container().emergencyCoordinator, 'triggerEmergency');

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });

    expect(trigger).toHaveBeenCalledWith(expect.any(String), expect.any(String), EmergencyTriggerSource.MANUAL_SOS);
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].triggerSource).toBe(EmergencyTriggerSource.MANUAL_SOS);
    expect(container().activationManager.getActivationState()).toBe(ActivationState.INACTIVE);

    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();
    expect(useEmergencyStore.getState().isTriggering).toBe(false);
  });

  test('SOS does not wait for location/network: no location data → emergency still created, card says pending', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    expect(await events()).toHaveLength(1);
    await screen.findByTestId('emergency-screen');
    expect(rowText('card-location')).toContain('Getting location');
  });

  test('pressing SOS again with an open emergency never creates a second one', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    fireEvent.press(screen.getByTestId('emergency-back'));
    await screen.findByTestId('home-unarmed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();
    const all = await events();
    expect(all.filter((e) => isOpenEmergencyState(e.state))).toHaveLength(1);
    expect(all).toHaveLength(1);
  });

  // ---------- emergency rendering ----------

  test('Emergency screen: trigger, truthful empty states, live location, resolve closes it', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    const eventId = useEmergencyStore.getState().currentEvent!.eventId;

    expect(screen.getByText('EMERGENCY ACTIVE')).toBeTruthy();
    expect(screen.getByTestId('emergency-timer')).toBeTruthy();
    expect(rowText('card-trigger')).toContain('Manual SOS');
    expect(rowText('card-contacts')).toContain('Not sent');
    expect(rowText('card-evidence')).toContain('Auto');
    expect(rowText('card-threat')).toContain('Off');
    expect(rowText('card-sync')).toContain('Local');

    act(() =>
      useLocationStore.setState({
        emergencyLocation: {
          eventId,
          status: EmergencyLocationStatus.AVAILABLE,
          reason: null,
          latestFix: {
            latitude: 18.5,
            longitude: 73.8,
            accuracyMeters: 9,
            altitudeMeters: null,
            speedMps: null,
            headingDegrees: null,
            timestamp: Date.now(),
            provider: LocationProvider.FUSED,
            isLastKnown: false,
          },
          pointCount: 1,
          tracking: LocationTrackingState.ACTIVE,
          trackingFailureReason: null,
        },
      })
    );
    expect(rowText('card-location')).toContain('Live');
    expect(rowText('card-location')).toContain('±9 m');

    fireEvent.press(screen.getByTestId('emergency-resolve'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-resolve-confirm'));
    });

    const stored = (await events()).find((e) => e.eventId === eventId)!;
    expect(stored.state).toBe(EmergencyState.RESOLVED);
    expect(await screen.findByTestId('home-unarmed')).toBeTruthy();
  });

  test('location for a different event is never shown on this emergency', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    act(() =>
      useLocationStore.setState({
        emergencyLocation: {
          eventId: 'some-other-event',
          status: EmergencyLocationStatus.AVAILABLE,
          reason: null,
          latestFix: null,
          pointCount: 3,
          tracking: LocationTrackingState.ACTIVE,
          trackingFailureReason: null,
        },
      })
    );
    expect(rowText('card-location')).toContain('Pending');
  });

  test('voice and shake emergencies are presented automatically with their trigger source', async () => {
    await renderApp();
    act(() =>
      useVoiceStore.setState({
        lastPayload: {
          triggerId: 't',
          source: 'VOICE',
          timestamp: Date.now(),
          keywordDetected: 'sheguard help me',
          confidence: 1,
          detectorSessionId: 's',
          metadata: { modelVersion: 'v', isBackground: false },
        } as never,
      })
    );
    await act(async () => {
      await container().voiceActivationAdapter.simulateVoiceTrigger();
    });
    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();
    expect(rowText('card-trigger')).toContain('sheguard help me');
  });

  test('cancel in Resolve dialog keeps the emergency open', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    fireEvent.press(screen.getByTestId('emergency-resolve'));
    fireEvent.press(screen.getByTestId('emergency-resolve-cancel'));
    const open = (await events()).filter((e) => isOpenEmergencyState(e.state));
    expect(open).toHaveLength(1);
    expect(screen.getByTestId('emergency-screen')).toBeTruthy();
  });

  test('an emergency restored at startup is presented once navigation is ready', async () => {
    await container().emergencyCoordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useEmergencyStore.setState(initialEmergency, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();

    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();
  });
});
