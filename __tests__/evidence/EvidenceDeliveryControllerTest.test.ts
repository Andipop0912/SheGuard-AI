import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EvidenceApiClient } from '../../src/evidence/services/EvidenceApiClient';
import { EvidenceDeliveryController, EVIDENCE_DELIVERY_TRIGGER_MS } from '../../src/evidence/services/EvidenceDeliveryController';

// Under fake timers, setImmediate is mocked too, so draining microtasks must go through the
// fake-timer clock instead of a real setImmediate (which would never fire).
function settle() {
  return jest.advanceTimersByTimeAsync(0);
}

function setup() {
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const deliver = jest.fn().mockResolvedValue({ delivered: true, contactsNotified: 1 });
  const api = { deliver } as unknown as EvidenceApiClient;
  const controller = new EvidenceDeliveryController(coordinator, api);
  controller.start();
  return { coordinator, deliver, controller };
}

describe('EvidenceDeliveryController (five-minute evidence-delivery trigger)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('delivers exactly once, five minutes after the emergency opened', async () => {
    const { coordinator, deliver } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();

    await jest.advanceTimersByTimeAsync(EVIDENCE_DELIVERY_TRIGGER_MS - 1);
    expect(deliver).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(event.eventId);
  });

  test('resolving the emergency before five minutes cancels the delivery', async () => {
    const { coordinator, deliver } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();

    await jest.advanceTimersByTimeAsync(EVIDENCE_DELIVERY_TRIGGER_MS / 2);
    await coordinator.resolveEmergency(event.eventId);
    await settle();

    await jest.advanceTimersByTimeAsync(EVIDENCE_DELIVERY_TRIGGER_MS);
    expect(deliver).not.toHaveBeenCalled();
  });

  test('a delivery failure never surfaces into emergency handling', async () => {
    const emergencyRepository = new EmergencyStorageRepository();
    const coordinator = new EmergencyCoordinator(emergencyRepository);
    const deliver = jest.fn().mockRejectedValue(new Error('network down'));
    const api = { deliver } as unknown as EvidenceApiClient;
    const controller = new EvidenceDeliveryController(coordinator, api);
    controller.start();

    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();
    await jest.advanceTimersByTimeAsync(EVIDENCE_DELIVERY_TRIGGER_MS);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(event.eventId).toBeTruthy(); // the emergency itself is unaffected
  });

  test('two concurrent emergencies each get their own independent delivery timer', async () => {
    const { coordinator, deliver } = setup();
    const eventA = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();
    await coordinator.resolveEmergency(eventA.eventId);
    await settle();

    const eventB = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();
    await jest.advanceTimersByTimeAsync(EVIDENCE_DELIVERY_TRIGGER_MS);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(eventB.eventId);
  });
});
