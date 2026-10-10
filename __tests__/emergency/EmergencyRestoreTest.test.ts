import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';

describe('EmergencyCoordinator.restoreActiveEvent', () => {
  test('an open emergency survives an app restart', async () => {
    const first = new EmergencyCoordinator(new EmergencyStorageRepository());
    const event = await first.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);

    // Simulate a new JS runtime: fresh repository + coordinator over the same storage.
    const restarted = new EmergencyCoordinator(new EmergencyStorageRepository());
    const observed: (string | null)[] = [];
    restarted.subscribeActiveEvent((e) => observed.push(e?.eventId ?? null));

    const restored = await restarted.restoreActiveEvent();

    expect(restored?.eventId).toBe(event.eventId);
    expect(restored?.state).toBe(EmergencyState.RESPONDING);
    expect(restarted.getCurrentActiveEvent()?.eventId).toBe(event.eventId);
    expect(observed).toEqual([null, event.eventId]);
  });

  test('resolved and cancelled emergencies are not restored', async () => {
    const first = new EmergencyCoordinator(new EmergencyStorageRepository());
    const a = await first.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await first.resolveEmergency(a.eventId);
    const b = await first.triggerEmergency('u', 'd', EmergencyTriggerSource.GESTURE);
    await first.cancelEmergency(b.eventId);

    const restarted = new EmergencyCoordinator(new EmergencyStorageRepository());
    expect(await restarted.restoreActiveEvent()).toBeNull();
    expect(restarted.getCurrentActiveEvent()).toBeNull();
  });
});
