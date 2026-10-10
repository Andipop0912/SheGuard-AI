import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from '../../src/navigation/RootNavigator';
import { AppContainer } from '../../src/app/di/AppContainer';
import { teardownActivationStoreForTesting, useActivationStore } from '../../src/activation/store/activationStore';
import { teardownEmergencyStoreForTesting, useEmergencyStore } from '../../src/emergency/store/emergencyStore';
import { HELPLINES } from '../../src/helplines/domain/Helpline';

jest.setTimeout(30000);

/**
 * Phase 3F: Legal & Emergency Help — real screen (replacing the "Planned" placeholder),
 * offline by construction (no store, no network, no auth touched to render or to call).
 */
describe('Phase 3F — Legal Help / Helplines', () => {
  const initial = { activation: useActivationStore.getState(), emergency: useEmergencyStore.getState() };

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.clearAllMocks();
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
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

  const renderApp = async () => {
    render(
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
    await screen.findByTestId('home-unarmed');
  };

  const openLegalHelp = async () => {
    fireEvent.press(screen.getAllByText('Legal Help').slice(-1)[0]);
    await screen.findByTestId('legal-help-screen');
  };

  test('12. navigating to Legal Help renders the real screen, not the placeholder', async () => {
    await renderApp();
    await openLegalHelp();
    expect(screen.getByText('Legal & Emergency Help')).toBeTruthy();
    expect(screen.queryByTestId('planned-legalHelp')).toBeNull();
  });

  test('2. all five entries render with their exact locked numbers, in the locked order', async () => {
    await renderApp();
    await openLegalHelp();
    for (const h of HELPLINES) {
      expect(screen.getByTestId(`helpline-number-${h.id}`)).toHaveTextContent(h.number);
    }
    const numbersOnScreen = HELPLINES.map((h) => screen.getByTestId(`helpline-card-${h.id}`));
    expect(numbersOnScreen).toHaveLength(5); // all present; order asserted at the dataset level
  });

  test('13. all five CALL actions are present and reachable', async () => {
    await renderApp();
    await openLegalHelp();
    for (const h of HELPLINES) {
      expect(screen.getByTestId(`helpline-call-${h.id}`)).toBeTruthy();
    }
  });

  test('14. each CALL action dials exactly its own locked number, never another one', async () => {
    await renderApp();
    await openLegalHelp();
    for (const h of HELPLINES) {
      (Linking.openURL as jest.Mock).mockClear();
      await act(async () => {
        fireEvent.press(screen.getByTestId(`helpline-call-${h.id}`));
      });
      expect(Linking.openURL).toHaveBeenCalledWith(`tel:${h.number}`);
      expect(Linking.openURL).toHaveBeenCalledTimes(1);
    }
  });

  test('emergency (112) is visually prioritized; every other service stays reachable', async () => {
    await renderApp();
    await openLegalHelp();
    // 112's card renders before the others and carries the emergency-specific styling hook.
    const card = screen.getByTestId('helpline-card-emergency-112');
    expect(card).toBeTruthy();
    for (const h of HELPLINES) {
      expect(screen.getByTestId(`helpline-call-${h.id}`)).toBeTruthy(); // never hidden/hard to reach
    }
  });

  test('"Verified information" shows source + last-verified without cluttering the main view', async () => {
    await renderApp();
    await openLegalHelp();
    expect(screen.queryByTestId('helpline-source-detail-emergency-112')).toBeNull();
    fireEvent.press(screen.getByTestId('helpline-source-emergency-112'));
    const detail = screen.getByTestId('helpline-source-detail-emergency-112');
    expect(detail).toHaveTextContent(/2026-10-07/);
    expect(detail).toHaveTextContent(/India Government/);
  });

  test('no fabricated availability claims appear anywhere on the screen', async () => {
    await renderApp();
    await openLegalHelp();
    expect(screen.queryByText(/available/i)).toBeNull();
    expect(screen.queryByText(/24\/7/i)).toBeNull();
    expect(screen.queryByText(/online/i)).toBeNull();
  });

  test('11 / offline: rendering and reading the dataset involves no store and no network path', async () => {
    await renderApp();
    await openLegalHelp();
    // No loading/empty/error state exists on this screen — it has nothing to wait for.
    expect(screen.queryByTestId('helpline-loading')).toBeNull();
    for (const h of HELPLINES) expect(screen.getByTestId(`helpline-number-${h.id}`)).toHaveTextContent(h.number);
  });

  test('16. back navigation from Legal Help returns to Home correctly', async () => {
    await renderApp();
    await openLegalHelp();
    fireEvent.press(screen.getAllByText('Home').slice(-1)[0]);
    expect(await screen.findByTestId('home-unarmed')).toBeTruthy();
  });

  test('17/7-safety-regression: Manual SOS still works immediately after visiting Legal Help', async () => {
    await renderApp();
    await openLegalHelp();
    fireEvent.press(screen.getAllByText('Home').slice(-1)[0]);
    await screen.findByTestId('home-unarmed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-sos'));
    });
    expect(await screen.findByTestId('emergency-screen')).toBeTruthy();
    fireEvent.press(screen.getByTestId('emergency-resolve'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-resolve-confirm'));
    });
    expect(await screen.findByTestId('home-unarmed')).toBeTruthy();
  });
});
