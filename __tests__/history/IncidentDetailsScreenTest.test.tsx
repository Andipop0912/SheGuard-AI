import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { IncidentDetailsScreen } from '../../src/features/history/IncidentDetailsScreen';
import { useEmergencyStore } from '../../src/emergency/store/emergencyStore';
import { useEvidenceStore } from '../../src/evidence/store/evidenceStore';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EvidenceSyncStatus, EvidenceType } from '../../src/evidence/domain/EvidenceItem';
import { EvidencePlaybackModule } from '../../src/evidence/native/EvidencePlaybackBridge';
import { EvidenceDownloadModule } from '../../src/evidence/native/EvidenceDownloadBridge';
import { EvidenceApiClient } from '../../src/evidence/services/EvidenceApiClient';
import { AppContainer } from '../../src/app/di/AppContainer';

jest.setTimeout(15000);

const EVENT_ID = 'evt-details-1';

const Stack = createNativeStackNavigator();
const TestApp: React.FC = () => (
  <SafeAreaProvider>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="IncidentDetails"
          component={IncidentDetailsScreen as React.ComponentType}
          initialParams={{ eventId: EVENT_ID }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  </SafeAreaProvider>
);

function seedEvent() {
  useEmergencyStore.setState({
    allEvents: [
      {
        eventId: EVENT_ID,
        userId: 'u',
        deviceId: 'd',
        triggerSource: EmergencyTriggerSource.MANUAL_SOS,
        state: EmergencyState.RESOLVED,
        createdAt: Date.now() - 600_000,
        updatedAt: Date.now(),
        resolvedAt: Date.now(),
        syncStatus: SyncStatus.SYNCED,
      },
    ],
  });
}

function seedEvidence(overrides: Partial<{ syncStatus: EvidenceSyncStatus }> = {}) {
  const items = [
    {
      evidenceId: 'ev-1',
      eventId: EVENT_ID,
      type: EvidenceType.AUDIO,
      filePath: '/fake/evidence/ev-1.m4a',
      createdAt: Date.now() - 500_000,
      durationMs: 12_000,
      syncStatus: overrides.syncStatus ?? EvidenceSyncStatus.LOCAL_ONLY,
    },
  ];
  // The screen's useEffect calls evidenceController.getItemsForEvent() on mount, which would
  // otherwise overwrite a direct store injection with the (empty) real repository's contents.
  jest.spyOn(AppContainer.getInstance().evidenceController, 'getItemsForEvent').mockResolvedValue(items);
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  seedEvent();
  seedEvidence();
});

afterEach(() => {
  jest.restoreAllMocks();
  useEmergencyStore.setState({ allEvents: [] });
  useEvidenceStore.setState({ itemsByEvent: {} });
});

const renderScreen = () => render(<TestApp />);

test('renders the evidence item with Play and Download actions', async () => {
  renderScreen();
  expect(await screen.findByTestId('incident-details-screen')).toBeTruthy();
  expect(screen.getByTestId('incident-evidence-play-0')).toBeTruthy();
  expect(screen.getByTestId('incident-evidence-download-0')).toBeTruthy();
});

test('pressing Play starts native playback of the local file, pressing again stops it', async () => {
  let resolvePlay: (v: { completed: boolean }) => void = () => {};
  const playSpy = jest
    .spyOn(EvidencePlaybackModule.prototype, 'play')
    .mockReturnValue(new Promise((resolve) => { resolvePlay = resolve; }));
  const stopSpy = jest.spyOn(EvidencePlaybackModule.prototype, 'stop').mockImplementation(async () => {
    resolvePlay({ completed: false });
  });

  renderScreen();
  await screen.findByTestId('incident-details-screen');

  await act(async () => { fireEvent.press(screen.getByTestId('incident-evidence-play-0')); });
  expect(playSpy).toHaveBeenCalledWith('/fake/evidence/ev-1.m4a');
  await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

  await act(async () => { fireEvent.press(screen.getByTestId('incident-evidence-play-0')); });
  expect(stopSpy).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText('Play')).toBeTruthy());
});

test('a local playback failure for an already-uploaded item falls back to the cloud signed URL', async () => {
  seedEvidence({ syncStatus: EvidenceSyncStatus.UPLOADED });
  jest.spyOn(EvidencePlaybackModule.prototype, 'play')
    .mockRejectedValueOnce(new Error('FILE_NOT_FOUND'))
    .mockResolvedValueOnce({ completed: true });
  const urlSpy = jest
    .spyOn(EvidenceApiClient.prototype, 'getEvidenceDownloadUrl')
    .mockResolvedValue('https://storage.example/signed/ev-1.m4a');

  renderScreen();
  await screen.findByTestId('incident-details-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('incident-evidence-play-0')); });

  await waitFor(() => expect(urlSpy).toHaveBeenCalledWith('ev-1'));
  await waitFor(() => expect(EvidencePlaybackModule.prototype.play).toHaveBeenCalledWith('https://storage.example/signed/ev-1.m4a'));
});

test('pressing Download saves the local file to Downloads and shows a success message', async () => {
  const saveSpy = jest.spyOn(EvidenceDownloadModule.prototype, 'saveLocalFile').mockResolvedValue(undefined);

  renderScreen();
  await screen.findByTestId('incident-details-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('incident-evidence-download-0')); });

  expect(saveSpy).toHaveBeenCalledWith('/fake/evidence/ev-1.m4a', 'SheGuard-Evidence-ev-1.m4a', 'audio/m4a');
  expect(await screen.findByTestId('incident-evidence-status')).toHaveTextContent(/saved to downloads/i);
});

test('Download falls back to the cloud copy when the local file is gone but the item was uploaded', async () => {
  seedEvidence({ syncStatus: EvidenceSyncStatus.UPLOADED });
  jest.spyOn(EvidenceDownloadModule.prototype, 'saveLocalFile').mockRejectedValue(new Error('FILE_NOT_FOUND'));
  const urlSpy = jest
    .spyOn(EvidenceApiClient.prototype, 'getEvidenceDownloadUrl')
    .mockResolvedValue('https://storage.example/signed/ev-1.m4a');
  const downloadUrlSpy = jest.spyOn(EvidenceDownloadModule.prototype, 'downloadUrl').mockResolvedValue(undefined);

  renderScreen();
  await screen.findByTestId('incident-details-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('incident-evidence-download-0')); });

  await waitFor(() => expect(urlSpy).toHaveBeenCalledWith('ev-1'));
  expect(downloadUrlSpy).toHaveBeenCalledWith('https://storage.example/signed/ev-1.m4a', 'SheGuard-Evidence-ev-1.m4a', 'audio/m4a');
  expect(await screen.findByTestId('incident-evidence-status')).toHaveTextContent(/saved to downloads/i);
});

test('Download PDF Report generates and downloads the cloud report', async () => {
  const reportSpy = jest
    .spyOn(EvidenceApiClient.prototype, 'generateReport')
    .mockResolvedValue({ reportId: 'rep-1', url: 'https://storage.example/signed/rep-1.pdf' });
  const downloadUrlSpy = jest.spyOn(EvidenceDownloadModule.prototype, 'downloadUrl').mockResolvedValue(undefined);

  renderScreen();
  await screen.findByTestId('incident-details-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('incident-download-pdf-report')); });

  expect(reportSpy).toHaveBeenCalledWith(EVENT_ID);
  await waitFor(() =>
    expect(downloadUrlSpy).toHaveBeenCalledWith(
      'https://storage.example/signed/rep-1.pdf',
      `SheGuard-Incident-Report-${EVENT_ID}.pdf`,
      'application/pdf'
    )
  );
  expect(await screen.findByTestId('incident-evidence-status')).toHaveTextContent(/report saved to downloads/i);
});

test('Download PDF Report shows a truthful failure message when generation fails', async () => {
  jest.spyOn(EvidenceApiClient.prototype, 'generateReport').mockResolvedValue(null);

  renderScreen();
  await screen.findByTestId('incident-details-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('incident-download-pdf-report')); });

  expect(await screen.findByTestId('incident-evidence-status')).toHaveTextContent(/could not be generated/i);
});
