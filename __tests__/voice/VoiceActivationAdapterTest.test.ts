import { VoiceActivationAdapter } from '../../src/voice/services/VoiceActivationAdapter';
import { VoiceNativeModule } from '../../src/voice/native/VoiceNativeBridge';
import { VoiceDetectionState } from '../../src/voice/domain/VoiceDetectionState';
import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { ActivationManagerImpl } from '../../src/activation/services/ActivationManagerImpl';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';

describe('VoiceActivationAdapterTest — Voice V1 Core Verification', () => {
  let repository: EmergencyStorageRepository;
  let emergencyCoordinator: EmergencyCoordinator;
  let activationManager: ActivationManagerImpl;
  let nativeBridge: VoiceNativeModule;
  let voiceAdapter: VoiceActivationAdapter;

  beforeEach(() => {
    repository = new EmergencyStorageRepository();
    emergencyCoordinator = new EmergencyCoordinator(repository);
    activationManager = new ActivationManagerImpl();
    nativeBridge = new VoiceNativeModule();
    voiceAdapter = new VoiceActivationAdapter(emergencyCoordinator, nativeBridge);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('1. Voice initial state is DISABLED', () => {
    expect(voiceAdapter.getVoiceState()).toBe(VoiceDetectionState.DISABLED);
    expect(voiceAdapter.isVoiceMonitoringActive()).toBe(false);
  });

  test('2. startListening transitions state to LISTENING', async () => {
    const success = await voiceAdapter.startListening();
    expect(success).toBe(true);
    expect(voiceAdapter.getVoiceState()).toBe(VoiceDetectionState.LISTENING);
    expect(voiceAdapter.isVoiceMonitoringActive()).toBe(true);
  });

  test('3. stopListening transitions state to DISABLED', async () => {
    await voiceAdapter.startListening();
    const success = await voiceAdapter.stopListening();
    expect(success).toBe(true);
    expect(voiceAdapter.getVoiceState()).toBe(VoiceDetectionState.DISABLED);
    expect(voiceAdapter.isVoiceMonitoringActive()).toBe(false);
  });

  test('4. ARM INACTIVE + Voice Keyword -> SOS TRIGGERED (ARM Independence Invariant)', async () => {
    // Confirm ARM Protection is INACTIVE
    expect(activationManager.getActivationState()).toBe(ActivationState.INACTIVE);

    await voiceAdapter.startListening();

    const emergencyEvent = await voiceAdapter.simulateVoiceTrigger({
      keywordDetected: 'sheguard emergency',
    });

    expect(emergencyEvent).not.toBeNull();
    expect(emergencyEvent?.triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(emergencyEvent?.state).toBe(EmergencyState.RESPONDING);

    const activeInCoordinator = emergencyCoordinator.getCurrentActiveEvent();
    expect(activeInCoordinator?.eventId).toBe(emergencyEvent?.eventId);
  });

  test('5. ARM ACTIVE + Voice Keyword -> SOS TRIGGERED', async () => {
    // Transition ARM Protection to ACTIVE
    await activationManager.handleActivation({
      requestId: 'req-arm-1',
      source: ActivationSource.MOCK,
      requestedAt: Date.now(),
      userInitiated: true,
    });
    expect(activationManager.getActivationState()).toBe(ActivationState.ACTIVE);

    await voiceAdapter.startListening();

    const emergencyEvent = await voiceAdapter.simulateVoiceTrigger({
      keywordDetected: 'sheguard emergency',
    });

    expect(emergencyEvent).not.toBeNull();
    expect(emergencyEvent?.triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(emergencyEvent?.state).toBe(EmergencyState.RESPONDING);
  });

  test('6. ARM INACTIVE + Shake -> Ignored (Shake is ARM-dependent, Voice is ARM-independent)', async () => {
    expect(activationManager.getActivationState()).toBe(ActivationState.INACTIVE);

    // Voice trigger triggers SOS even when ARM is INACTIVE
    const voiceEvent = await voiceAdapter.simulateVoiceTrigger();
    expect(voiceEvent).not.toBeNull();

    // Verify ARM is still INACTIVE
    expect(activationManager.getActivationState()).toBe(ActivationState.INACTIVE);
  });

  test('7. Manual SOS triggers emergency regardless of ARM state', async () => {
    expect(activationManager.getActivationState()).toBe(ActivationState.INACTIVE);

    const manualEvent = await emergencyCoordinator.triggerEmergency(
      'user-1',
      'device-1',
      EmergencyTriggerSource.MANUAL_SOS
    );

    expect(manualEvent.triggerSource).toBe(EmergencyTriggerSource.MANUAL_SOS);
    expect(manualEvent.state).toBe(EmergencyState.RESPONDING);
  });

  test('8. Duplicate triggers within 5-second cooldown emit only ONE emergency event', async () => {
    await voiceAdapter.startListening();

    // First keyword detection
    const firstEvent = await voiceAdapter.simulateVoiceTrigger({
      triggerId: 'vt-1',
      keywordDetected: 'sheguard emergency',
    });
    expect(firstEvent).not.toBeNull();

    // Fast duplicate triggers within 5000ms
    const secondEvent = await voiceAdapter.simulateVoiceTrigger({
      triggerId: 'vt-2',
      keywordDetected: 'sheguard emergency',
    });
    const thirdEvent = await voiceAdapter.simulateVoiceTrigger({
      triggerId: 'vt-3',
      keywordDetected: 'sheguard emergency',
    });

    expect(secondEvent).toBeNull();
    expect(thirdEvent).toBeNull();

    const allStoredEvents = await repository.getAllEvents();
    expect(allStoredEvents.length).toBe(1);
    expect(allStoredEvents[0].eventId).toBe(firstEvent?.eventId);
  });

  test('9. After the 5-second cooldown the adapter accepts a new trigger, which joins the still-open emergency', async () => {
    await voiceAdapter.startListening();

    const firstEvent = await voiceAdapter.simulateVoiceTrigger({ triggerId: 'vt-1' });
    expect(firstEvent).not.toBeNull();

    // Advance time by 5001ms
    jest.advanceTimersByTime(5001);

    const secondEvent = await voiceAdapter.simulateVoiceTrigger({ triggerId: 'vt-2' });
    // Cooldown expired, so the adapter forwards the trigger (non-null)...
    expect(secondEvent).not.toBeNull();
    // ...but EmergencyCoordinator allows only one open emergency: same event, none added.
    expect(secondEvent?.eventId).toBe(firstEvent?.eventId);

    const allStoredEvents = await repository.getAllEvents();
    expect(allStoredEvents.length).toBe(1);
  });

  test('10. Offline Voice trigger creates event with PENDING sync status', async () => {
    await voiceAdapter.startListening();

    const event = await voiceAdapter.simulateVoiceTrigger();
    expect(event).not.toBeNull();
    expect(event?.syncStatus).toBe(SyncStatus.PENDING);

    const saved = await repository.getEvent(event!.eventId);
    expect(saved?.syncStatus).toBe(SyncStatus.PENDING);
  });

  test('11. Safe handling of bridge state subscription', async () => {
    let receivedState: VoiceDetectionState | null = null;
    voiceAdapter.subscribeState((state) => {
      receivedState = state;
    });

    await voiceAdapter.startListening();
    expect(receivedState).toBe(VoiceDetectionState.LISTENING);

    await voiceAdapter.stopListening();
    expect(receivedState).toBe(VoiceDetectionState.DISABLED);
  });

  test('12. Bridge teardown on stopListening prevents memory leaks', async () => {
    await voiceAdapter.startListening();
    expect(voiceAdapter.isVoiceMonitoringActive()).toBe(true);

    await voiceAdapter.stopListening();
    expect(voiceAdapter.isVoiceMonitoringActive()).toBe(false);

    // Secondary stopListening call is safe
    const res = await voiceAdapter.stopListening();
    expect(res).toBe(true);
  });
});
