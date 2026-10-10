import { AppContainer } from '../../src/app/di/AppContainer';
import {
  teardownActivationStoreForTesting,
  useActivationStore,
} from '../../src/activation/store/activationStore';
import {
  teardownEmergencyStoreForTesting,
  useEmergencyStore,
} from '../../src/emergency/store/emergencyStore';
import { GestureActivationAdapter } from '../../src/activation/services/GestureActivationAdapter';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';

/**
 * Shake is ARM dependent: the native detector runs only while protection is ACTIVE, and the
 * adapter rejects any shake event received while not ACTIVE.
 */
describe('Shake detection wired to ARM (activationStore → GestureActivationAdapter)', () => {
  const initialActivation = useActivationStore.getState();
  const initialEmergency = useEmergencyStore.getState();

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    teardownEmergencyStoreForTesting();
    AppContainer.resetForTesting();
    useActivationStore.setState(initialActivation, true);
    useEmergencyStore.setState(initialEmergency, true);
    useActivationStore.getState().startActivationSource();
    await useEmergencyStore.getState().initialize();
  });

  afterEach(() => {
    teardownActivationStoreForTesting();
    jest.restoreAllMocks();
  });

  const container = () => AppContainer.getInstance();
  const arm = () => container().mockActivationSource.simulateActivation(true);
  const events = () => container().emergencyRepository.getAllEvents();

  test('ARM OFF: shake detector is not running and a shake creates no emergency', async () => {
    expect(useActivationStore.getState().activationState).toBe(ActivationState.INACTIVE);
    expect(container().gestureActivationSource.getIsListening()).toBe(false);
    expect(useActivationStore.getState().isShakeListening).toBe(false);

    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(false);
    expect(await events()).toHaveLength(0);
  });

  test('ARM ON: detector starts; one shake → exactly one GESTURE emergency', async () => {
    arm();
    await Promise.resolve();
    expect(useActivationStore.getState().activationState).toBe(ActivationState.ACTIVE);
    expect(container().gestureActivationSource.getIsListening()).toBe(true);
    expect(useActivationStore.getState().isShakeListening).toBe(true);

    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(true);

    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].triggerSource).toBe(EmergencyTriggerSource.GESTURE);
    expect(useEmergencyStore.getState().currentEvent?.eventId).toBe(all[0].eventId);
  });

  test('repeated shakes while the emergency is open never create a second emergency', async () => {
    arm();
    await Promise.resolve();
    for (let i = 0; i < 4; i++) {
      await container().gestureActivationSource.handleGestureDetected();
    }
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all.filter((e) => isOpenEmergencyState(e.state))).toHaveLength(1);
  });

  test('full toggle: OFF → no emergency, ON → one, resolve, OFF → no emergency (detector stopped)', async () => {
    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(false);

    arm();
    await Promise.resolve();
    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(true);
    const [event] = await events();
    await useEmergencyStore.getState().resolveEmergency(event.eventId);

    await useActivationStore.getState().stopProtection();
    expect(useActivationStore.getState().activationState).toBe(ActivationState.INACTIVE);
    expect(container().gestureActivationSource.getIsListening()).toBe(false);
    expect(useActivationStore.getState().isShakeListening).toBe(false);

    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(false);
    expect(await events()).toHaveLength(1);
  });

  test('re-arming after resolve allows a new shake emergency', async () => {
    arm();
    await Promise.resolve();
    await container().gestureActivationSource.handleGestureDetected();
    const [first] = await events();
    await useEmergencyStore.getState().resolveEmergency(first.eventId);

    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(true);
    expect(await events()).toHaveLength(2);
  });

  test('voice still triggers while ARM is OFF (only shake is ARM dependent)', async () => {
    expect(useActivationStore.getState().activationState).toBe(ActivationState.INACTIVE);
    await container().voiceActivationAdapter.simulateVoiceTrigger({ keywordDetected: 'she guard help me' });
    expect((await events())[0].triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(await container().gestureActivationSource.handleGestureDetected()).toBe(false);
    expect(await events()).toHaveLength(1);
  });

  test('fail closed: an adapter without an ActivationManager rejects shake', async () => {
    const triggerEmergency = jest.fn();
    const orphan = new GestureActivationAdapter(undefined, () => ({ triggerEmergency }) as never);
    expect(await orphan.handleGestureDetected()).toBe(false);
    expect(triggerEmergency).not.toHaveBeenCalled();
  });
});
