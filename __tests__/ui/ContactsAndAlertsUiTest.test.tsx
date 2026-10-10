import React from 'react';
import '@testing-library/react-native/extend-expect';
import { Alert } from 'react-native';
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
import { useContactsStore } from '../../src/contacts/store/contactsStore';
import { useCommunicationStore } from '../../src/communication/store/communicationStore';
import { startServerSync, stopServerSyncForTesting } from '../../src/sync/startServerSync';
import { FAKE_BASE_URL, FakeBackend, fakeCommunicationLog } from '../net/fakes';

jest.setTimeout(30000);

/** Phase 3D UI: Settings → Trusted Contacts, add/edit/limits, and the truthful Emergency contacts card. */
describe('Phase 3D — trusted contacts and contact alerts in the UI', () => {
  const initial = {
    activation: useActivationStore.getState(),
    emergency: useEmergencyStore.getState(),
    auth: useAuthStore.getState(),
    sync: useSyncStore.getState(),
    contacts: useContactsStore.getState(),
    communication: useCommunicationStore.getState(),
  };
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
    useActivationStore.setState(initial.activation, true);
    useEmergencyStore.setState(initial.emergency, true);
    useAuthStore.setState(initial.auth, true);
    useSyncStore.setState(initial.sync, true);
    useContactsStore.setState(initial.contacts, true);
    useCommunicationStore.setState(initial.communication, true);

    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
    useAuthStore.getState().initialize();
    await AppContainer.getInstance().authService.restore();
    startServerSync();
  });

  afterEach(() => {
    stopServerSyncForTesting();
    AppContainer.getInstance().communicationStatusService.stop();
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

  const signIn = async () => {
    backend.seedUser('+919000000001', 'secret123');
    await act(async () => {
      await useAuthStore.getState().login('9000000001', 'secret123');
    });
  };

  const openContacts = async () => {
    fireEvent.press(screen.getAllByText('Settings').slice(-1)[0]);
    fireEvent.press(await screen.findByTestId('settings-trusted-contacts'));
  };

  test('signed out: Trusted Contacts asks to sign in (no request made)', async () => {
    await renderApp();
    await openContacts();
    expect(await screen.findByTestId('contacts-signed-out')).toBeTruthy();
    expect(backend.calls.filter((c) => c.path.startsWith('/contacts'))).toHaveLength(0);
  });

  test('add a contact: normalized preview, saved as +91, listed with limits shown', async () => {
    await signIn();
    await renderApp();
    await openContacts();
    expect(await screen.findByTestId('contacts-empty')).toBeTruthy();
    expect(screen.getByTestId('contacts-counts')).toHaveTextContent('0 of 10 contacts · 0 of 5 active');

    fireEvent.press(screen.getByTestId('contacts-add'));
    await screen.findByTestId('contact-form-add');
    fireEvent.changeText(screen.getByTestId('contact-name'), 'Mom');
    fireEvent.changeText(screen.getByTestId('contact-phone'), '098765 43210');
    expect(screen.getByTestId('contact-phone-normalized')).toHaveTextContent('Saved as +91 98765 43210');
    await act(async () => {
      fireEvent.press(screen.getByTestId('contact-save'));
    });

    expect(await screen.findByTestId('contact-row-+919876543210')).toBeTruthy();
    expect(backend.contacts.values().next().value?.[0]).toMatchObject({ phone: '+919876543210', is_active: true });
  });

  test('invalid number is rejected with a clear message before any request', async () => {
    await signIn();
    await renderApp();
    await openContacts();
    await screen.findByTestId('contacts-empty');
    fireEvent.press(screen.getByTestId('contacts-add'));
    await screen.findByTestId('contact-form-add');
    fireEvent.changeText(screen.getByTestId('contact-name'), 'X');
    fireEvent.changeText(screen.getByTestId('contact-phone'), '+1 415 555 0100');
    await act(async () => {
      fireEvent.press(screen.getByTestId('contact-save'));
    });
    expect(screen.getByText(/valid Indian mobile number/)).toBeTruthy();
    expect(backend.calls.filter((c) => c.path === '/contacts' && c.method === 'POST')).toHaveLength(0);
  });

  test('activating a 6th contact explains the 5-active limit', async () => {
    await signIn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const repo = AppContainer.getInstance().contactsRepository;
    for (let i = 0; i < 5; i++) {
      await repo.create({ name: `A${i}`, phone: `987654320${i}`, relationship: null, priority: i + 1, isActive: true });
    }
    await repo.create({ name: 'Extra', phone: '9876543299', relationship: null, priority: 6, isActive: false });

    await renderApp();
    await openContacts();
    await screen.findByTestId('contact-row-+919876543299');
    expect(screen.getByTestId('contacts-counts')).toHaveTextContent('6 of 10 contacts · 5 of 5 active');
    await act(async () => {
      fireEvent(screen.getByTestId('contact-active-+919876543299'), 'valueChange', true);
    });
    expect(alert).toHaveBeenCalledWith('Can’t activate contact', expect.stringMatching(/at most 5 active/));
    expect(backend.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  test('Emergency card while signed out: "Not sent — sign in", SOS still instant', async () => {
    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    expect(text('card-contacts')).toContain('sign in to alert');
    expect(text('card-contacts')).not.toMatch(/Notification sent/i);
  });

  test('Emergency card shows the server records truthfully: SIMULATED • ACCEPTED / NOT SENT', async () => {
    await signIn();
    await AppContainer.getInstance().contactsRepository.create({
      name: 'Mom', phone: '9876543210', relationship: null, priority: 1, isActive: true,
    });
    backend.onEventInserted = (eventId) =>
      backend.communicationLogs.set(eventId, [
        fakeCommunicationLog({ event_id: eventId, contact_name: 'Mom', status: 'PROVIDER_ACCEPTED', is_simulated: true }),
        fakeCommunicationLog({
          event_id: eventId, contact_name: 'Dad', status: 'NOT_SENT', reason_code: 'channel_not_available', is_simulated: false,
        }),
      ]);

    await renderApp();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    await screen.findByTestId('emergency-screen');
    await waitFor(() => expect(text('card-contacts')).toContain('Mom: SIMULATED • ACCEPTED'), { timeout: 5000 });
    expect(text('card-contacts')).toContain('Dad: NOT SENT • CHANNEL NOT AVAILABLE');
    expect(text('card-contacts')).toContain('Simulated');
    expect(text('card-contacts')).not.toMatch(/Notification sent|delivered/i);
  });
});
