import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { createEmergencyEvent, EmergencyEvent } from '../../src/emergency/domain/EmergencyEvent';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';

const KEY = '@sheguard_emergency_events_v1';

function event(eventId: string, triggerSource: EmergencyTriggerSource): EmergencyEvent {
  return createEmergencyEvent({ eventId, userId: 'u', deviceId: 'd', triggerSource });
}

describe('EmergencyStorageRepository persistence', () => {
  test('a save issued right after construction keeps previously persisted history', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify([event('evt-old', EmergencyTriggerSource.VOICE)]));

    const repository = new EmergencyStorageRepository();
    // No await between construction and save: this used to overwrite storage with only the new event.
    await repository.saveEvent(event('evt-new', EmergencyTriggerSource.MANUAL_SOS));

    const stored: EmergencyEvent[] = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    expect(stored.map((e) => e.eventId).sort()).toEqual(['evt-new', 'evt-old']);
  });

  test('reads issued right after construction see persisted events', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify([event('evt-old', EmergencyTriggerSource.GESTURE)]));

    const all = await new EmergencyStorageRepository().getAllEvents();

    expect(all.map((e) => e.eventId)).toEqual(['evt-old']);
  });

  test('saved events are written to AsyncStorage', async () => {
    await new EmergencyStorageRepository().saveEvent(event('evt-1', EmergencyTriggerSource.MANUAL_SOS));

    const stored: EmergencyEvent[] = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    expect(stored.map((e) => e.eventId)).toEqual(['evt-1']);
  });
});
