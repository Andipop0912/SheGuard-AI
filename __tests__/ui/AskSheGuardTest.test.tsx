/**
 * AskSheGuardTest.test.tsx — Phase 3J
 *
 * Tests verify (per spec):
 * 1.  Ask screen renders
 * 2.  User can enter a message
 * 3.  Send action sends the message
 * 4.  Loading / typing indicator appears while waiting
 * 5.  Successful AI response is rendered
 * 6.  Error response is rendered
 * 7.  Empty input is blocked (send disabled)
 * 8.  Immediate-danger response shows SOS banner
 * 9.  Ask SheGuard NEVER auto-creates an emergency
 * 10. Offline / NOT_CONFIGURED state shown truthfully
 * 11. Conversation accumulates (multiple turns rendered)
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AskSheGuardScreen } from '../../src/features/ask/AskSheGuardScreen';
import { AskSheGuardApiService } from '../../src/features/ask/AskSheGuardApiService';
import { AskVoiceInputModule } from '../../src/features/ask/AskVoiceInputBridge';
import { AppContainer } from '../../src/app/di/AppContainer';
import {
  teardownEmergencyStoreForTesting,
  useEmergencyStore,
} from '../../src/emergency/store/emergencyStore';
import { teardownActivationStoreForTesting, useActivationStore } from '../../src/activation/store/activationStore';

jest.setTimeout(15000);

jest.mock('../../src/evidence/native/evidencePermissions', () => ({
  ensureEvidencePermissions: jest.fn().mockResolvedValue('granted'),
}));

// ──────────────────────────────────────────────────────────────
// Minimal stack for rendering AskSheGuardScreen with navigation
// ──────────────────────────────────────────────────────────────
const Stack = createNativeStackNavigator();
const TestApp: React.FC = () => (
  <SafeAreaProvider>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AskSheGuard" component={AskSheGuardScreen as React.ComponentType} />
      </Stack.Navigator>
    </NavigationContainer>
  </SafeAreaProvider>
);

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function mockApiService(impl: Partial<AskSheGuardApiService>): jest.SpyInstance {
  return jest
    .spyOn(AppContainer.getInstance(), 'apiClient', 'get')
    .mockReturnValue({} as never);
}

let askSpy: jest.SpyInstance;

beforeEach(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  teardownEmergencyStoreForTesting();
  AppContainer.resetForTesting();
  useActivationStore.getState().startActivationSource();
  await useEmergencyStore.getState().initialize();

  askSpy = jest.spyOn(AskSheGuardApiService.prototype, 'ask');
});

afterEach(() => {
  teardownActivationStoreForTesting();
  teardownEmergencyStoreForTesting();
  jest.restoreAllMocks();
});

const renderScreen = () => render(<TestApp />);

// ──────────────────────────────────────────────────────────────
// 1. Screen renders
// ──────────────────────────────────────────────────────────────
test('1. Ask SheGuard screen renders with welcome message', async () => {
  renderScreen();
  expect(await screen.findByTestId('ask-sheguard-screen')).toBeTruthy();
  expect(screen.getByTestId('ask-input')).toBeTruthy();
  expect(screen.getByTestId('ask-send')).toBeTruthy();
  // Welcome message from assistant
  expect(screen.getByText(/How can I help you stay safe/i)).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 2. User can enter a message
// ──────────────────────────────────────────────────────────────
test('2. User can type in the input field', async () => {
  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), 'What should I do?');
  expect(screen.getByTestId('ask-input').props.value).toBe('What should I do?');
});

// ──────────────────────────────────────────────────────────────
// 3. Send action — input cleared, API called
// ──────────────────────────────────────────────────────────────
test('3. Pressing Send triggers the API call and clears the input', async () => {
  askSpy.mockResolvedValueOnce({ ok: true, reply: 'Stay alert and trust your instincts.' });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');

  fireEvent.changeText(screen.getByTestId('ask-input'), 'Safety tips?');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  // Input is cleared immediately after send
  await waitFor(() => expect(screen.getByTestId('ask-input').props.value).toBe(''));
  expect(askSpy).toHaveBeenCalledTimes(1);
  const callArg = askSpy.mock.calls[0][0];
  expect(callArg[callArg.length - 1].content).toBe('Safety tips?');
});

// ──────────────────────────────────────────────────────────────
// 4. Loading state shown while waiting
// ──────────────────────────────────────────────────────────────
test('4. Typing indicator is shown while AI is loading', async () => {
  // Never resolves during this test
  askSpy.mockReturnValueOnce(new Promise(() => {}));

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), 'Hello?');

  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  expect(screen.getByTestId('ask-typing')).toBeTruthy();
  // Send button disabled while loading
  expect(screen.getByTestId('ask-send').props.accessibilityState?.disabled ?? true).toBe(true);
});

// ──────────────────────────────────────────────────────────────
// 5. Successful AI response rendered
// ──────────────────────────────────────────────────────────────
test('5. Successful AI response appears as an assistant bubble', async () => {
  const REPLY = 'Stay in well-lit areas and trust your instincts.';
  askSpy.mockResolvedValueOnce({ ok: true, reply: REPLY });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), 'What should I do?');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  expect(await screen.findByText(REPLY)).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 6. Error response rendered
// ──────────────────────────────────────────────────────────────
test('6. Error response is shown in an error bubble (no crash)', async () => {
  askSpy.mockResolvedValueOnce({
    ok: false,
    kind: 'NETWORK',
    message: 'Ask SheGuard needs an internet connection for AI responses.',
  });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), 'Hello?');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  expect(await screen.findByText(/internet connection/i)).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 7. Empty input is blocked
// ──────────────────────────────────────────────────────────────
test('7. Send button is disabled when the input is empty', async () => {
  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  // Input is empty by default
  const sendBtn = screen.getByTestId('ask-send');
  expect(sendBtn.props.accessibilityState?.disabled ?? sendBtn.props.disabled).toBeTruthy();
});

test('7b. Send button is disabled for whitespace-only input', async () => {
  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), '   ');
  const sendBtn = screen.getByTestId('ask-send');
  expect(sendBtn.props.accessibilityState?.disabled ?? sendBtn.props.disabled).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 8. Immediate-danger response shows SOS banner
// ──────────────────────────────────────────────────────────────
test('8. SOS banner appears when AI returns an immediate-danger response', async () => {
  const DANGER_REPLY =
    '🚨 YOUR SAFETY FIRST: If you are in immediate danger, press the red SOS button NOW or call emergency services:\n• Police: 100\n• Women\'s Helpline: 1091\n• Emergency: 112\n\nDo not wait — your SOS button works even offline.';
  askSpy.mockResolvedValueOnce({ ok: true, reply: DANGER_REPLY });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), "I'm being attacked");
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  expect(await screen.findByTestId('ask-sos-banner')).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 9. Ask SheGuard NEVER creates an emergency automatically
// ──────────────────────────────────────────────────────────────
test('9. Ask SheGuard never creates an emergency even for danger messages', async () => {
  const DANGER_REPLY =
    '🚨 YOUR SAFETY FIRST: If you are in immediate danger, press the red SOS button NOW or call emergency services:\n• Police: 100';
  askSpy.mockResolvedValueOnce({ ok: true, reply: DANGER_REPLY });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), "Help me right now");
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  await screen.findByTestId('ask-sos-banner');

  // EmergencyStore must NOT have a currentEvent
  const emergencyState = useEmergencyStore.getState();
  expect(emergencyState.currentEvent).toBeNull();
});

// ──────────────────────────────────────────────────────────────
// 10. Offline / NOT_CONFIGURED state
// ──────────────────────────────────────────────────────────────
test('10. NOT_CONFIGURED error shows an informative offline/not-configured message', async () => {
  askSpy.mockResolvedValueOnce({
    ok: false,
    kind: 'NOT_CONFIGURED',
    message: 'Server not configured.',
  });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  fireEvent.changeText(screen.getByTestId('ask-input'), 'Hello');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });

  expect(await screen.findByText(/not configured/i)).toBeTruthy();
});

// ──────────────────────────────────────────────────────────────
// 11. Conversation accumulates (multiple turns)
// ──────────────────────────────────────────────────────────────
test('11. Multiple turns accumulate in the conversation list', async () => {
  askSpy
    .mockResolvedValueOnce({ ok: true, reply: 'First AI reply.' })
    .mockResolvedValueOnce({ ok: true, reply: 'Second AI reply.' });

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');

  // First turn
  fireEvent.changeText(screen.getByTestId('ask-input'), 'First question?');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });
  await screen.findByText('First AI reply.');

  // Second turn
  fireEvent.changeText(screen.getByTestId('ask-input'), 'Second question?');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });
  await screen.findByText('Second AI reply.');

  // Both user messages and both AI replies must be visible
  expect(screen.getByText('First question?')).toBeTruthy();
  expect(screen.getByText('Second question?')).toBeTruthy();
  expect(screen.getByText('First AI reply.')).toBeTruthy();
  expect(screen.getByText('Second AI reply.')).toBeTruthy();

  // Second call history must include prior turns
  expect(askSpy).toHaveBeenCalledTimes(2);
  const secondCallHistory = askSpy.mock.calls[1][0];
  expect(secondCallHistory.length).toBeGreaterThan(2); // includes prior user + assistant
});

// ──────────────────────────────────────────────────────────────
// 12. Voice input
// ──────────────────────────────────────────────────────────────
test('12. Mic button renders and is enabled by default', async () => {
  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  const mic = screen.getByTestId('ask-mic');
  expect(mic).toBeTruthy();
  expect(mic.props.accessibilityState?.disabled ?? false).toBe(false);
});

test('13. A recognized utterance fills the text input (not auto-sent)', async () => {
  const recognizeSpy = jest.spyOn(AskVoiceInputModule.prototype, 'recognize').mockResolvedValue('Am I safe walking home alone?');

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-mic')); });

  await waitFor(() => expect(screen.getByTestId('ask-input').props.value).toBe('Am I safe walking home alone?'));
  expect(recognizeSpy).toHaveBeenCalledTimes(1);
  expect(askSpy).not.toHaveBeenCalled(); // filling the box is not the same as sending
});

test('14. A failed recognition (no speech) shows an error bubble, never crashes', async () => {
  const error = Object.assign(new Error('No speech recognized'), { code: 'NO_SPEECH' });
  jest.spyOn(AskVoiceInputModule.prototype, 'recognize').mockRejectedValue(error);

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  await act(async () => { fireEvent.press(screen.getByTestId('ask-mic')); });

  expect(await screen.findByText(/didn't catch that/i)).toBeTruthy();
  expect(screen.getByTestId('ask-sheguard-screen')).toBeTruthy(); // screen still mounted, no crash
});

test('15. The mic button shows a listening state while recognition is in progress', async () => {
  let resolveRecognize: (value: string) => void = () => {};
  jest.spyOn(AskVoiceInputModule.prototype, 'recognize').mockReturnValue(
    new Promise((resolve) => { resolveRecognize = resolve; })
  );

  renderScreen();
  await screen.findByTestId('ask-sheguard-screen');
  act(() => { fireEvent.press(screen.getByTestId('ask-mic')); });

  await waitFor(() => expect(screen.getByTestId('ask-mic').props.accessibilityState?.disabled).toBe(true));

  await act(async () => { resolveRecognize('Test phrase'); });
  await waitFor(() => expect(screen.getByTestId('ask-input').props.value).toBe('Test phrase'));
});
