import { VoiceActivationAdapter } from '../../src/voice/services/VoiceActivationAdapter';
import { VoiceNativeInterface } from '../../src/voice/native/VoiceNativeBridge';
import { VoiceTriggerPayload } from '../../src/voice/domain/VoiceTriggerPayload';
import { VoiceDetectionState } from '../../src/voice/domain/VoiceDetectionState';
import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState, isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { ActivationManagerImpl } from '../../src/activation/services/ActivationManagerImpl';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';
import { ActivationState } from '../../src/activation/domain/ActivationState';

/** Recognition forms emitted by the native VoiceDetectionService (VoicePhraseCatalog.kt). */
const APPROVED_PHRASES = [
  'she guard emergency',
  'she guard help',
  'she guard help me',
  'she guard i need help',
  "she guard i'm in danger",
  'she guard i am in danger',
  'she guard call for help',
  'she guard please help me',
  'she guard save me',
  'she guard emergency help',
];

/** Stands in for the native module: lets a test emit VOICE_TRIGGER_DETECTED payloads. */
class FakeVoiceBridge implements VoiceNativeInterface {
  private triggerCallback: ((payload: VoiceTriggerPayload) => void) | null = null;
  public async startVoiceDetection() {
    return true;
  }
  public async stopVoiceDetection() {
    return true;
  }
  public async isVoiceDetectionRunning() {
    return true;
  }
  public async getVoiceState() {
    return VoiceDetectionState.LISTENING;
  }
  public onVoiceTriggerDetected(callback: (payload: VoiceTriggerPayload) => void) {
    this.triggerCallback = callback;
    return () => {
      this.triggerCallback = null;
    };
  }
  public onVoiceStateChanged() {
    return () => {};
  }
  /** Native payload shape after a FINAL, validated recognition. */
  public emit(phrase: string, confidence = 0.97) {
    this.triggerCallback?.({
      triggerId: `vt-${phrase}-${Date.now()}`,
      source: 'VOICE',
      timestamp: Date.now(),
      keywordDetected: phrase,
      confidence,
      detectorSessionId: 'native-session',
      metadata: { modelVersion: 'vosk-model-small-en-us-0.15', isBackground: true },
    });
  }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('Voice V2 — approved phrases through the real adapter and coordinator', () => {
  let repository: EmergencyStorageRepository;
  let coordinator: EmergencyCoordinator;
  let bridge: FakeVoiceBridge;
  let adapter: VoiceActivationAdapter;
  let payloads: VoiceTriggerPayload[];

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    repository = new EmergencyStorageRepository();
    coordinator = new EmergencyCoordinator(repository);
    bridge = new FakeVoiceBridge();
    adapter = new VoiceActivationAdapter(coordinator, bridge);
    payloads = [];
    adapter.subscribeTriggerPayload((p) => payloads.push(p));
    await adapter.startListening();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const openEvents = async () => (await repository.getAllEvents()).filter((e) => isOpenEmergencyState(e.state));

  test.each(APPROVED_PHRASES)('"%s" creates a VOICE emergency and carries the phrase + real confidence', async (phrase) => {
    bridge.emit(phrase, 0.83);
    await flush();

    const events = await repository.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(events[0].state).toBe(EmergencyState.RESPONDING);
    expect(payloads[0].keywordDetected).toBe(phrase);
    expect(payloads[0].confidence).toBe(0.83);
  });

  test.each(APPROVED_PHRASES)('"%s" respects the 5 s cooldown', async (phrase) => {
    bridge.emit(phrase);
    await flush();
    bridge.emit(phrase); // within cooldown
    await flush();

    expect(payloads).toHaveLength(1);
    expect(await repository.getAllEvents()).toHaveLength(1);
  });

  test('different phrases during one open emergency never create a second emergency', async () => {
    for (const phrase of APPROVED_PHRASES) {
      bridge.emit(phrase);
      await flush();
      await jest.advanceTimersByTimeAsync(5_001); // past the adapter cooldown each time
    }

    const all = await repository.getAllEvents();
    expect(all).toHaveLength(1);
    expect(await openEvents()).toHaveLength(1);
    expect(coordinator.getAdditionalTriggers(all[0].eventId)).toHaveLength(APPROVED_PHRASES.length - 1);
  });

  test('after the emergency is resolved, a new phrase creates a new emergency', async () => {
    bridge.emit('she guard help me');
    await flush();
    const first = (await repository.getAllEvents())[0];
    await coordinator.resolveEmergency(first.eventId);
    await jest.advanceTimersByTimeAsync(5_001);

    bridge.emit('she guard save me');
    await flush();

    const all = await repository.getAllEvents();
    expect(all).toHaveLength(2);
    expect(await openEvents()).toHaveLength(1);
  });

  test('voice is ARM independent: triggers with protection OFF and with protection ON', async () => {
    const manager = new ActivationManagerImpl();
    expect(manager.getActivationState()).toBe(ActivationState.INACTIVE);

    bridge.emit('she guard i need help'); // ARM OFF
    await flush();
    expect(await repository.getAllEvents()).toHaveLength(1);
    await coordinator.resolveEmergency((await repository.getAllEvents())[0].eventId);
    await jest.advanceTimersByTimeAsync(5_001);

    await manager.handleActivation({
      requestId: 'arm', source: ActivationSource.MOCK, requestedAt: Date.now(), userInitiated: true,
    });
    expect(manager.getActivationState()).toBe(ActivationState.ACTIVE);
    bridge.emit('she guard call for help'); // ARM ON
    await flush();
    expect(await repository.getAllEvents()).toHaveLength(2);
  });

  test('offline: emergency is still created locally with PENDING sync', async () => {
    bridge.emit('she guard i am in danger');
    await flush();

    const [event] = await repository.getAllEvents();
    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(event.syncStatus).toBe(SyncStatus.PENDING);
  });

  test('existing "she guard emergency" behaviour is unchanged', async () => {
    bridge.emit('she guard emergency', 1);
    await flush();
    expect((await repository.getAllEvents())[0].triggerSource).toBe(EmergencyTriggerSource.VOICE);
    expect(payloads[0].keywordDetected).toBe('she guard emergency');
  });
});
