import { AppContainer } from '../../src/app/di/AppContainer';
import {
  teardownEmergencyStoreForTesting,
  useEmergencyStore,
} from '../../src/emergency/store/emergencyStore';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';

/**
 * The emergency store must mirror EmergencyCoordinator for every trigger source,
 * not only for emergencies started through the store itself.
 */
describe('emergencyStore observes EmergencyCoordinator', () => {
  const initialState = useEmergencyStore.getState();

  beforeEach(async () => {
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useEmergencyStore.setState(initialState, true);
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    AppContainer.getInstance().gestureActivationSource.stopListening();
  });

  test('voice trigger (ARM independent) reaches the store', async () => {
    await AppContainer.getInstance().voiceActivationAdapter.simulateVoiceTrigger();

    const event = useEmergencyStore.getState().currentEvent;
    expect(event?.triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(event?.state).toBe(EmergencyState.RESPONDING);
  });

  test('shake while disarmed is rejected and never reaches the store', async () => {
    const accepted = await AppContainer.getInstance().gestureActivationSource.handleGestureDetected();

    expect(accepted).toBe(false);
    expect(useEmergencyStore.getState().currentEvent).toBeNull();
  });

  test('shake while armed reaches the store', async () => {
    const container = AppContainer.getInstance();
    await container.activationManager.handleActivation({
      requestId: 'req-test',
      source: ActivationSource.MOCK,
      requestedAt: Date.now(),
      userInitiated: true,
    });

    const accepted = await container.gestureActivationSource.handleGestureDetected();

    expect(accepted).toBe(true);
    expect(useEmergencyStore.getState().currentEvent?.triggerSource).toBe(EmergencyTriggerSource.GESTURE);
  });

  test('an open emergency is restored into the store after a restart', async () => {
    const event = await AppContainer.getInstance().emergencyCoordinator.triggerEmergency(
      'u',
      'd',
      EmergencyTriggerSource.MANUAL_SOS
    );

    // New JS runtime over the same persisted storage.
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useEmergencyStore.setState(initialState, true);
    await useEmergencyStore.getState().initialize();

    expect(useEmergencyStore.getState().currentEvent?.eventId).toBe(event.eventId);
    expect(useEmergencyStore.getState().allEvents.map((e) => e.eventId)).toContain(event.eventId);
  });

  test('initialize is idempotent (single coordinator subscription)', async () => {
    await useEmergencyStore.getState().initialize();
    await useEmergencyStore.getState().initialize();

    const coordinator = AppContainer.getInstance().emergencyCoordinator as unknown as {
      listeners: Set<unknown>;
    };
    expect(coordinator.listeners.size).toBe(1);
  });
});
