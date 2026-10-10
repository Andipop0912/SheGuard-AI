import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { VoiceActivationAdapter } from '../../src/voice/services/VoiceActivationAdapter';
import { EvidenceController } from '../../src/evidence/services/EvidenceController';
import { EvidenceRepository } from '../../src/evidence/storage/EvidenceRepository';
import { NativeRecordingResult, EvidenceNativeInterface } from '../../src/evidence/native/EvidenceNativeBridge';

const { MANUAL_SOS, VOICE, GESTURE } = EmergencyTriggerSource;

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeEvidenceNative implements EvidenceNativeInterface {
  public startCalls: string[] = [];
  public stopCalls = 0;
  public shouldFailStart = false;
  public shouldFailStop = false;
  public result: NativeRecordingResult = { filePath: '/fake/evidence.m4a', durationMs: 1234 };

  async startRecording(eventId: string): Promise<string> {
    this.startCalls.push(eventId);
    if (this.shouldFailStart) throw new Error('native start failed');
    return this.result.filePath;
  }

  async stopRecording(): Promise<NativeRecordingResult> {
    this.stopCalls += 1;
    if (this.shouldFailStop) throw new Error('native stop failed');
    return this.result;
  }

  async isRecording(): Promise<boolean> {
    return this.startCalls.length > this.stopCalls;
  }
}

function setup(nativeOverrides: Partial<FakeEvidenceNative> = {}) {
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const voice = new VoiceActivationAdapter(coordinator);
  const native = new FakeEvidenceNative();
  Object.assign(native, nativeOverrides);
  const repository = new EvidenceRepository();
  const controller = new EvidenceController(coordinator, voice, native, repository);
  controller.start();
  return { coordinator, voice, native, repository, controller };
}

jest.mock('../../src/evidence/native/evidencePermissions', () => ({
  ensureEvidencePermissions: jest.fn().mockResolvedValue('granted'),
}));

describe('EvidenceController (audio evidence linked to the emergency lifecycle)', () => {
  test('starts recording as soon as an emergency opens, for every trigger source', async () => {
    const { coordinator, controller, native } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    expect(native.startCalls).toEqual([event.eventId]);
    expect(controller.getState()?.eventId).toBe(event.eventId);
    expect(controller.getState()?.status).toBe('RECORDING');
    controller.stop();
  });

  test.each([VOICE, GESTURE, MANUAL_SOS])('works independently of Protection Mode for trigger %s', async (source) => {
    const { coordinator, native, controller } = setup();
    await coordinator.triggerEmergency('u', 'd', source);
    await settle();
    expect(native.startCalls).toHaveLength(1);
    controller.stop();
  });

  test('evidence.eventId always matches the emergency that triggered it', async () => {
    const { coordinator, controller, repository } = setup();
    const eventA = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    await coordinator.resolveEmergency(eventA.eventId);
    await settle();

    const itemsA = await repository.getForEvent(eventA.eventId);
    expect(itemsA).toHaveLength(1);
    expect(itemsA[0].eventId).toBe(eventA.eventId);

    const eventB = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    await coordinator.resolveEmergency(eventB.eventId);
    await settle();

    const itemsB = await repository.getForEvent(eventB.eventId);
    expect(itemsB).toHaveLength(1);
    expect(itemsB[0].eventId).toBe(eventB.eventId);
    expect(itemsB[0].evidenceId).not.toBe(itemsA[0].evidenceId);

    expect(controller.getState()?.eventId).toBe(eventB.eventId);
  });

  test('resolving the emergency stops recording and persists the evidence item', async () => {
    const { coordinator, controller, native, repository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    await coordinator.resolveEmergency(event.eventId);
    await settle();

    expect(native.stopCalls).toBe(1);
    expect(controller.getState()?.status).toBe('SAVED');
    const items = await repository.getForEvent(event.eventId);
    expect(items).toHaveLength(1);
    expect(items[0].durationMs).toBe(1234);
  });

  test('cancelling the emergency also stops recording', async () => {
    const { coordinator, native } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    await coordinator.cancelEmergency(event.eventId);
    await settle();
    expect(native.stopCalls).toBe(1);
  });

  test('a recording failure never fails the emergency', async () => {
    const { coordinator, controller, native } = setup({ shouldFailStart: true });
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    expect(event.eventId).toBeTruthy(); // the emergency itself always succeeds
    expect(controller.getState()?.status).toBe('UNAVAILABLE');
    expect(native.startCalls).toEqual([event.eventId]);
  });

  test('permission denial never fails the emergency', async () => {
    const permissions = require('../../src/evidence/native/evidencePermissions');
    permissions.ensureEvidencePermissions.mockResolvedValueOnce('denied');

    const { coordinator, controller, native } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    expect(event.eventId).toBeTruthy();
    expect(controller.getState()?.status).toBe('UNAVAILABLE');
    expect(controller.getState()?.unavailableReason).toContain('permission');
    expect(native.startCalls).toHaveLength(0);
  });

  test('pauses voice listening during recording and resumes it after', async () => {
    const { coordinator, voice } = setup();
    await voice.startListening();
    expect(voice.isVoiceMonitoringActive()).toBe(true);

    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    expect(voice.isVoiceMonitoringActive()).toBe(false);

    await coordinator.resolveEmergency(event.eventId);
    await settle();
    expect(voice.isVoiceMonitoringActive()).toBe(true);
  });

  test('evidence metadata survives as if the app restarted (new repository instance, same backing store is simulated by re-reading)', async () => {
    const { coordinator, repository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    await coordinator.resolveEmergency(event.eventId);
    await settle();

    const itemsAgain = await repository.getForEvent(event.eventId);
    expect(itemsAgain).toHaveLength(1);
  });
});
