import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator, navigationRef } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import { teardownActivationStoreForTesting, useActivationStore } from '../../src/activation/store/activationStore';
import { teardownEmergencyStoreForTesting, useEmergencyStore } from '../../src/emergency/store/emergencyStore';
import { useVoiceStore } from '../../src/voice/store/voiceStore';
import { useLocationStore } from '../../src/location/store/locationStore';
import { useContactsStore } from '../../src/contacts/store/contactsStore';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { INITIAL_LOCATION_READINESS, LocationAvailability } from '../../src/location/domain/LocationState';

jest.setTimeout(30000);

/**
 * Settings rendered through the real navigator, over the real ActivationManager and
 * LocationService stores (AppContainer) — same integration approach as
 * HomeAndEmergencyScreensTest. Settings holds no state of its own, so every assertion here is
 * really exercising the shared stores through a second UI surface.
 */
describe('Settings screen', () => {
  const initialActivation = useActivationStore.getState();
  const initialEmergency = useEmergencyStore.getState();
  const initialVoice = useVoiceStore.getState();
  const initialLocation = useLocationStore.getState();
  const initialContacts = useContactsStore.getState();

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initialActivation, true);
    useEmergencyStore.setState(initialEmergency, true);
    useVoiceStore.setState(initialVoice, true);
    useLocationStore.setState(initialLocation, true);
    useContactsStore.setState(initialContacts, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownActivationStoreForTesting();
    teardownEmergencyStoreForTesting();
    jest.restoreAllMocks();
  });

  const container = () => AppContainer.getInstance();

  const renderApp = async () => {
    const utils = render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    act(() => {
      navigationRef.navigate('MainTabs', { screen: 'Settings' });
    });
    await screen.findByTestId('settings-screen');
    return utils;
  };

  test('renders every section with real (not fabricated) status', async () => {
    await renderApp();
    expect(screen.getByTestId('account-card')).toBeTruthy();
    expect(screen.getByTestId('settings-protection-toggle')).toBeTruthy();
    expect(screen.getByTestId('settings-status-shake')).toBeTruthy();
    expect(screen.getByTestId('settings-status-voice')).toBeTruthy();
    expect(screen.getByTestId('settings-trusted-contacts')).toBeTruthy();
    expect(screen.getByTestId('settings-location')).toBeTruthy();
    expect(screen.getByTestId('settings-route-safety')).toBeTruthy();
    expect(screen.getByTestId('settings-evidence-card')).toBeTruthy();
    expect(screen.getByTestId('settings-ask-sheguard')).toBeTruthy();
    expect(screen.getByTestId('settings-privacy-card')).toBeTruthy();
    expect(screen.getByTestId('settings-legal-help')).toBeTruthy();
    expect(screen.getByTestId('settings-about-card')).toBeTruthy();

    // Starts inactive — no fabricated "active" status.
    expect(screen.getByTestId('settings-protection-toggle').props.value).toBe(false);
  });

  test('Protection toggle arms through the real ActivationManager, same as Home', async () => {
    await renderApp();
    const handle = jest.spyOn(container().activationManager, 'handleActivation');

    await act(async () => {
      fireEvent(screen.getByTestId('settings-protection-toggle'), 'valueChange', true);
    });

    expect(handle).toHaveBeenCalled();
    expect(container().activationManager.getActivationState()).toBe(ActivationState.ACTIVE);
    expect(screen.getByTestId('settings-protection-toggle').props.value).toBe(true);

    await act(async () => {
      fireEvent(screen.getByTestId('settings-protection-toggle'), 'valueChange', false);
    });
    expect(container().activationManager.getActivationState()).toBe(ActivationState.INACTIVE);
  });

  test('Location row shows "Fix" and requests permission when permission is required', async () => {
    useLocationStore.setState({
      readiness: { ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.PERMISSION_REQUIRED },
    });
    const requestSpy = jest.spyOn(useLocationStore.getState(), 'requestPermission').mockResolvedValue(undefined);

    await renderApp();
    expect(screen.getByTestId('settings-location-action')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-location-action'));
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test('Location row opens OS settings when permission was denied', async () => {
    useLocationStore.setState({
      readiness: { ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.PERMISSION_DENIED },
    });
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-location-action'));
    });
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  test('Location row navigates to Live Location when available (no fabricated "Fix" action)', async () => {
    useLocationStore.setState({
      readiness: { ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.AVAILABLE },
    });

    await renderApp();
    expect(screen.queryByTestId('settings-location-action')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-location'));
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe('LiveLocation');
  });

  test('Trusted Contacts card shows the real active-contact count', async () => {
    useContactsStore.setState({
      contacts: [
        { id: 'c1', name: 'Mom', phone: '+919000000001', relationship: null, priority: 1, isActive: true },
        { id: 'c2', name: 'Friend', phone: '+919000000002', relationship: null, priority: 2, isActive: true },
        { id: 'c3', name: 'Old', phone: '+919000000003', relationship: null, priority: 3, isActive: false },
      ] as never,
    });

    await renderApp();
    expect(screen.getByText('2 active contacts')).toBeTruthy();
  });

  test('Trusted Contacts card is truthful when there are none yet', async () => {
    await renderApp();
    expect(screen.getByText('Add someone to alert in an emergency')).toBeTruthy();
  });

  test('pressing Trusted Contacts / Route Safety / Ask SheGuard navigates to the real screens', async () => {
    await renderApp();

    await act(async () => { fireEvent.press(screen.getByTestId('settings-ask-sheguard')); });
    expect(await screen.findByTestId('ask-sheguard-screen')).toBeTruthy();

    act(() => navigationRef.navigate('MainTabs', { screen: 'Settings' }));
    await act(async () => { fireEvent.press(screen.getByTestId('settings-route-safety')); });
    expect(navigationRef.getCurrentRoute()?.name).toBe('RouteSafety');

    act(() => navigationRef.navigate('MainTabs', { screen: 'Settings' }));
    await act(async () => { fireEvent.press(screen.getByTestId('settings-trusted-contacts')); });
    expect(navigationRef.getCurrentRoute()?.name).toBe('TrustedContacts');
  });

  test('Evidence card shows the real cloud-sync status from EvidenceSyncQueue, not a fabricated one', async () => {
    await renderApp();
    expect(await screen.findByTestId('settings-evidence-sync-status')).toHaveTextContent('Up to date');
  });

  test('does not expose any AI/backend secrets', async () => {
    await renderApp();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toMatch(/gemini[_-]?api[_-]?key/i);
    expect(tree).not.toMatch(/supabase[_-]?secret/i);
    expect(tree).not.toMatch(/fast2sms/i);
    expect(tree).not.toMatch(/jwt[_-]?secret/i);
  });
});
