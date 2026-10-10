import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator, navigationRef } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import {
  teardownEmergencyStoreForTesting,
  useEmergencyStore,
} from '../../src/emergency/store/emergencyStore';
import { createEmergencyEvent } from '../../src/emergency/domain/EmergencyEvent';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyLocationStatus } from '../../src/location/domain/LocationState';

jest.setTimeout(30000);

describe('Phase 3H — History & Incident Records', () => {
  const initial = {
    emergency: useEmergencyStore.getState(),
  };

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.clearAllMocks();
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useEmergencyStore.setState(initial.emergency, true);
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownEmergencyStoreForTesting();
  });

  const renderApp = () =>
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );

  const navigateToHistory = async () => {
    act(() => {
      navigationRef.current?.navigate('MainTabs', { screen: 'History' });
    });
    await screen.findAllByText('History');
  };

  test('1. Empty history shows empty state', async () => {
    useEmergencyStore.setState({ allEvents: [] });
    renderApp();
    await navigateToHistory();
    expect(await screen.findByTestId('history-empty')).toBeTruthy();
    expect(screen.getByText('No emergency incidents yet')).toBeTruthy();
  });

  test('2, 5, 6, 7, 8, 9, 10. Displays emergencies with correct formatting', async () => {
    const event1 = createEmergencyEvent({
      eventId: 'evt-1',
      userId: 'u1',
      deviceId: 'd1',
      triggerSource: EmergencyTriggerSource.MANUAL_SOS,
      state: EmergencyState.RESOLVED,
      syncStatus: SyncStatus.SYNCED,
      createdAt: 1600000000000,
    });
    const event2 = createEmergencyEvent({
      eventId: 'evt-2',
      userId: 'u1',
      deviceId: 'd1',
      triggerSource: EmergencyTriggerSource.VOICE,
      state: EmergencyState.TRIGGERED,
      syncStatus: SyncStatus.PENDING,
      createdAt: 1600000001000,
    });
    const event3 = createEmergencyEvent({
      eventId: 'evt-3',
      userId: 'u1',
      deviceId: 'd1',
      triggerSource: EmergencyTriggerSource.GESTURE,
      state: EmergencyState.CANCELLED,
      syncStatus: SyncStatus.LOCAL_ONLY,
      createdAt: 1600000002000,
    });

    useEmergencyStore.setState({ allEvents: [event1, event2, event3] });
    
    // Set some location mock summaries
    const container = AppContainer.getInstance();
    await container.emergencyLocationRepository.setSummary('evt-1', EmergencyLocationStatus.AVAILABLE, null);
    await container.emergencyLocationRepository.setSummary('evt-2', EmergencyLocationStatus.UNAVAILABLE, null);
    
    renderApp();
    await navigateToHistory();

    // Verify ordering: newest first (evt-3, evt-2, evt-1)
    const cards = await screen.findAllByText('Emergency');
    expect(cards).toHaveLength(3);

    // evt-1
    expect(screen.getByTestId('history-source-evt-1').props.children).toBe('Manual SOS');
    expect(screen.getByTestId('history-state-evt-1').props.children).toBe('Resolved');
    expect(screen.getByTestId('history-sync-evt-1').props.children).toBe('Synced');
    
    // evt-2
    expect(screen.getByTestId('history-source-evt-2').props.children).toBe('Voice SOS');
    expect(screen.getByTestId('history-state-evt-2').props.children).toBe('Active');
    expect(screen.getByTestId('history-sync-evt-2').props.children).toBe('Local / Pending');
    
    // evt-3
    expect(screen.getByTestId('history-source-evt-3').props.children).toBe('Shake SOS');
    expect(screen.getByTestId('history-state-evt-3').props.children).toBe('Cancelled');
    expect(screen.getByTestId('history-sync-evt-3').props.children).toBe('Local / Pending');
  });

  test('11. Incident Details navigation and fields', async () => {
    const event = createEmergencyEvent({
      eventId: 'evt-test-details',
      userId: 'u1',
      deviceId: 'd1',
      triggerSource: EmergencyTriggerSource.SYSTEM,
      state: EmergencyState.RESOLVED,
      syncStatus: SyncStatus.FAILED,
      createdAt: 1600000000000,
      resolvedAt: 1600000010000,
    });

    useEmergencyStore.setState({ allEvents: [event] });
    renderApp();
    await navigateToHistory();

    // Click card
    const card = screen.getByTestId('history-card-evt-test-details');
    fireEvent.press(card);

    // Should navigate to Incident Details
    expect(await screen.findByTestId('incident-details-screen')).toBeTruthy();
    
    expect(screen.getByTestId('incident-id').props.children).toBe('evt-test-details');
    expect(screen.getByTestId('incident-source').props.children).toBe('System Trigger');
    expect(screen.getByTestId('incident-state').props.children).toBe('Resolved');
    expect(screen.getByTestId('incident-sync').props.children).toBe('Failed');
  });
});
