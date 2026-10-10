import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import { resetIdentityForTesting } from '../../src/app/identity';
import { DEV_API_BASE_URL } from '../../src/api/apiConfig';
import { teardownActivationStoreForTesting, useActivationStore } from '../../src/activation/store/activationStore';
import { teardownEmergencyStoreForTesting, useEmergencyStore } from '../../src/emergency/store/emergencyStore';
import { teardownAuthStoreForTesting, useAuthStore } from '../../src/auth/store/authStore';
import { useSyncStore } from '../../src/sync/syncStore';
import { startServerSync, stopServerSyncForTesting } from '../../src/sync/startServerSync';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { FAKE_BASE_URL, FakeBackend } from '../net/fakes';

jest.setTimeout(30000);

/**
 * Phase 3C UI: account entry on Settings, sign-in, and the Emergency "Server" card, through the
 * real navigator and AppContainer (HTTP goes to the in-memory fake backend).
 */
describe('Phase 3C — account and truthful server state in the UI', () => {
  const initialActivation = useActivationStore.getState();
  const initialEmergency = useEmergencyStore.getState();
  const initialAuth = useAuthStore.getState();
  const initialSync = useSyncStore.getState();
  let backend: FakeBackend;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    backend = new FakeBackend();
    global.fetch = ((input: string, init?: RequestInit) =>
      backend.fetch(String(input).replace(DEV_API_BASE_URL, FAKE_BASE_URL), init)) as typeof fetch;

    resetIdentityForTesting();
    teardownEmergencyStoreForTesting();
    teardownAuthStoreForTesting();
    stopServerSyncForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initialActivation, true);
    useEmergencyStore.setState(initialEmergency, true);
    useAuthStore.setState(initialAuth, true);
    useSyncStore.setState(initialSync, true);

    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
    useAuthStore.getState().initialize();
    await AppContainer.getInstance().authService.restore();
    startServerSync();
  });

  afterEach(() => {
    stopServerSyncForTesting();
    teardownActivationStoreForTesting();
    teardownEmergencyStoreForTesting();
    teardownAuthStoreForTesting();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const renderApp = async () => {
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
  };

  const text = (testID: string) =>
    screen
      .getByTestId(testID)
      .findAll(() => true)
      .map((n: { props: { children?: unknown } }) => (typeof n.props.children === 'string' ? n.props.children : ''))
      .join('|');

  const openSettings = async () => {
    fireEvent.press(screen.getAllByText('Settings').slice(-1)[0]);
    await screen.findByTestId('account-card');
  };

  test('signed out: Settings shows "Not signed in"; SOS works and the Server card says sign in to back up', async () => {
    await renderApp();
    await openSettings();
    expect(screen.getByText('Not signed in')).toBeTruthy();

    fireEvent.press(screen.getAllByText('Home').slice(-1)[0]);
    await screen.findByTestId('home-unarmed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    expect(text('card-sync')).toContain('sign in to back it up');
    expect(text('card-sync')).toContain('Local');
    expect(backend.calls).toHaveLength(0);
  });

  test('sign in from Settings → account shows phone; a new SOS becomes "Synced" only after the server confirms', async () => {
    await renderApp();
    await openSettings();
    backend.seedUser('+919876543210', 'secret123');

    fireEvent.press(screen.getByTestId('account-sign-in'));
    await screen.findByTestId('auth-signIn');
    fireEvent.changeText(screen.getByTestId('auth-phone'), '98765 43210');
    fireEvent.changeText(screen.getByTestId('auth-password'), 'secret123');
    await act(async () => {
      fireEvent.press(screen.getByTestId('auth-submit'));
    });

    expect(await screen.findByTestId('account-phone')).toBeTruthy();
    expect(text('account-phone')).toContain('+919876543210');

    fireEvent.press(screen.getAllByText('Home').slice(-1)[0]);
    await screen.findByTestId('home-unarmed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');

    await waitFor(() => expect(text('card-sync')).toContain('Synced'));
    const [event] = await AppContainer.getInstance().emergencyRepository.getAllEvents();
    expect(event.syncStatus).toBe(SyncStatus.SYNCED);
    expect(backend.events.has(event.eventId)).toBe(true);
  });

  test('wrong password shows an honest error and stays signed out', async () => {
    await renderApp();
    await openSettings();
    backend.seedUser('+919876543210', 'secret123');
    fireEvent.press(screen.getByTestId('account-sign-in'));
    await screen.findByTestId('auth-signIn');
    fireEvent.changeText(screen.getByTestId('auth-phone'), '9876543210');
    fireEvent.changeText(screen.getByTestId('auth-password'), 'wrong-one');
    await act(async () => {
      fireEvent.press(screen.getByTestId('auth-submit'));
    });
    expect(await screen.findByTestId('auth-error')).toBeTruthy();
    expect(text('auth-error')).toContain('Incorrect mobile number or password');
    expect(useAuthStore.getState().session).toBeNull();
  });

  test('signed in but server unreachable: SOS is immediate; Server card says waiting, never "Synced"', async () => {
    backend.seedUser('+919876543210', 'secret123');
    await act(async () => {
      await useAuthStore.getState().login('9876543210', 'secret123');
    });
    backend.offline = true;
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    await waitFor(() => expect(text('card-sync')).toContain('waiting to sync'));
    expect(text('card-sync')).not.toContain('Synced');
  });
});
