import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState, isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';
import { VoiceActivationAdapter } from '../../src/voice/services/VoiceActivationAdapter';
import { VoiceNativeInterface } from '../../src/voice/native/VoiceNativeBridge';
import { GestureActivationAdapter } from '../../src/activation/services/GestureActivationAdapter';
import { ActivationManagerImpl } from '../../src/activation/services/ActivationManagerImpl';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';

const { MANUAL_SOS, VOICE, GESTURE, HARDWARE_BUTTON } = EmergencyTriggerSource;

/** Native voice bridge stub: these tests drive the adapter directly. */
function stubVoiceBridge(): VoiceNativeInterface {
  return {
    startVoiceDetection: async () => true,
    stopVoiceDetection: async () => true,
    isVoiceDetectionRunning: async () => true,
    getVoiceState: async () => 'LISTENING' as never,
    onVoiceTriggerDetected: () => () => {},
    onVoiceStateChanged: () => () => {},
  };
}

describe('EmergencyCoordinator — single open emergency invariant', () => {
  let repository: EmergencyStorageRepository;
  let coordinator: EmergencyCoordinator;

  const openEvents = async () =>
    (await repository.getAllEvents()).filter((e) => isOpenEmergencyState(e.state));

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    repository = new EmergencyStorageRepository();
    coordinator = new EmergencyCoordinator(repository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1. the first trigger creates exactly one emergency', async () => {
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);

    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(await repository.getAllEvents()).toHaveLength(1);
    expect(coordinator.getCurrentActiveEvent()?.eventId).toBe(event.eventId);
  });

  test('2. a second trigger while open returns the same event and is recorded', async () => {
    const first = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    const second = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);

    expect(second.eventId).toBe(first.eventId);
    expect(await repository.getAllEvents()).toHaveLength(1);
    expect(coordinator.getAdditionalTriggers(first.eventId)).toEqual([
      expect.objectContaining({ eventId: first.eventId, triggerSource: MANUAL_SOS }),
    ]);
  });

  test('3. voice + voice cannot create two open events (through the real adapter)', async () => {
    jest.useFakeTimers();
    try {
      const voice = new VoiceActivationAdapter(coordinator, stubVoiceBridge());
      await voice.startListening();

      const first = await voice.simulateVoiceTrigger({ triggerId: 'vt-1' });
      jest.advanceTimersByTime(5001); // past the adapter's own cooldown
      const second = await voice.simulateVoiceTrigger({ triggerId: 'vt-2' });

      expect(second?.eventId).toBe(first?.eventId);
      expect(await openEvents()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('4. voice + gesture cannot create two open events', async () => {
    const manager = new ActivationManagerImpl();
    await manager.handleActivation({
      requestId: 'arm',
      source: ActivationSource.MOCK,
      requestedAt: Date.now(),
      userInitiated: true,
    });
    const gesture = new GestureActivationAdapter(() => manager, () => coordinator);

    const voiceEvent = await coordinator.triggerEmergency('u', 'd', VOICE);
    const accepted = await gesture.handleGestureDetected();

    expect(accepted).toBe(true); // ARM rule unchanged: shake accepted while armed
    expect(await openEvents()).toHaveLength(1);
    expect(coordinator.getAdditionalTriggers(voiceEvent.eventId).map((t) => t.triggerSource)).toEqual([
      GESTURE,
    ]);
  });

  test('5. manual + voice cannot create two open events', async () => {
    const manual = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    const voice = await coordinator.triggerEmergency('u', 'd', VOICE);

    expect(voice.eventId).toBe(manual.eventId);
    expect(voice.triggerSource).toBe(MANUAL_SOS); // the original trigger is preserved
    expect(await openEvents()).toHaveLength(1);
  });

  test('6. after RESOLVED, a new trigger creates a new emergency', async () => {
    const first = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await coordinator.resolveEmergency(first.eventId);

    const next = await coordinator.triggerEmergency('u', 'd', VOICE);

    expect(next.eventId).not.toBe(first.eventId);
    expect(next.state).toBe(EmergencyState.RESPONDING);
    expect(await repository.getAllEvents()).toHaveLength(2);
    expect(await openEvents()).toHaveLength(1);
  });

  test('7. after CANCELLED, a new trigger creates a new emergency', async () => {
    const first = await coordinator.triggerEmergency('u', 'd', GESTURE);
    await coordinator.cancelEmergency(first.eventId);

    const next = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);

    expect(next.eventId).not.toBe(first.eventId);
    expect(await repository.getAllEvents()).toHaveLength(2);
    expect(await openEvents()).toHaveLength(1);
  });

  test('8. concurrent triggers from every source converge on one emergency', async () => {
    const results = await Promise.all([
      coordinator.triggerEmergency('u', 'd', MANUAL_SOS),
      coordinator.triggerEmergency('u', 'd', VOICE),
      coordinator.triggerEmergency('u', 'd', GESTURE),
      coordinator.triggerEmergency('u', 'd', HARDWARE_BUTTON),
      coordinator.triggerEmergency('u', 'd', VOICE),
    ]);

    const ids = new Set(results.map((e) => e.eventId));
    expect(ids.size).toBe(1);
    expect(await repository.getAllEvents()).toHaveLength(1);
    expect(coordinator.getAdditionalTriggers()).toHaveLength(4);
  });

  test('8b. a trigger right after a restart joins the persisted open emergency', async () => {
    const before = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);

    // New runtime over the same storage; nothing called restoreActiveEvent() yet.
    const restarted = new EmergencyCoordinator(new EmergencyStorageRepository());
    const after = await Promise.all([
      restarted.triggerEmergency('u', 'd', VOICE),
      restarted.triggerEmergency('u', 'd', GESTURE),
    ]);

    expect(after.map((e) => e.eventId)).toEqual([before.eventId, before.eventId]);
    expect(await new EmergencyStorageRepository().getAllEvents()).toHaveLength(1);
  });

  test('8c. the lock is released if creation fails, so the next trigger can succeed', async () => {
    const saveSpy = jest
      .spyOn(repository, 'saveEvent')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(coordinator.triggerEmergency('u', 'd', MANUAL_SOS)).rejects.toThrow('storage unavailable');

    saveSpy.mockRestore();
    const retried = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    expect(retried.state).toBe(EmergencyState.RESPONDING);
    expect(await openEvents()).toHaveLength(1);
  });
});
