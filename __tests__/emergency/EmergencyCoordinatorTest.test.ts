import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';

describe('EmergencyCoordinatorTest', () => {
  let repository: EmergencyStorageRepository;
  let coordinator: EmergencyCoordinator;

  beforeEach(() => {
    repository = new EmergencyStorageRepository();
    coordinator = new EmergencyCoordinator(repository);
  });

  test('trigger emergency creates a local event with PENDING sync status (no network involved)', async () => {
    const event = await coordinator.triggerEmergency(
      'user-1',
      'device-1',
      EmergencyTriggerSource.MANUAL_SOS
    );

    expect(event.eventId).toBeDefined();
    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(event.syncStatus).toBe(SyncStatus.PENDING);

    const saved = await repository.getEvent(event.eventId);
    expect(saved).not.toBeNull();
    expect(saved?.syncStatus).toBe(SyncStatus.PENDING);
  });

  test('the coordinator never marks an event SYNCED itself (only the server can confirm)', async () => {
    const event = await coordinator.triggerEmergency('user-1', 'device-1', EmergencyTriggerSource.MANUAL_SOS);
    await coordinator.resolveEmergency(event.eventId);

    const saved = await repository.getEvent(event.eventId);
    expect(saved?.syncStatus).toBe(SyncStatus.PENDING);
    expect((coordinator as unknown as Record<string, unknown>).syncEvent).toBeUndefined();
  });

  test('a lifecycle change after a confirmed upload makes the event PENDING again', async () => {
    const event = await coordinator.triggerEmergency('user-1', 'device-1', EmergencyTriggerSource.MANUAL_SOS);
    await repository.applySyncOutcome(event.eventId, event.updatedAt, { syncStatus: SyncStatus.SYNCED, syncedAt: 1 });
    expect((await repository.getEvent(event.eventId))?.syncStatus).toBe(SyncStatus.SYNCED);

    const resolved = await coordinator.resolveEmergency(event.eventId);
    expect(resolved?.syncStatus).toBe(SyncStatus.PENDING);
  });

  test('resolve emergency updates state to RESOLVED', async () => {
    const event = await coordinator.triggerEmergency(
      'user-1',
      'device-1',
      EmergencyTriggerSource.MANUAL_SOS
    );

    const resolved = await coordinator.resolveEmergency(event.eventId);
    expect(resolved?.state).toBe(EmergencyState.RESOLVED);
    expect(resolved?.resolvedAt).toBeDefined();
  });

  test('cancel emergency updates state to CANCELLED', async () => {
    const event = await coordinator.triggerEmergency(
      'user-1',
      'device-1',
      EmergencyTriggerSource.MANUAL_SOS
    );

    const cancelled = await coordinator.cancelEmergency(event.eventId);
    expect(cancelled?.state).toBe(EmergencyState.CANCELLED);
    expect(cancelled?.resolvedAt).toBeDefined();
  });

  test('queued events stay PENDING until uploaded by the sync service', async () => {
    const first = await coordinator.triggerEmergency('user-1', 'device-1', EmergencyTriggerSource.MANUAL_SOS);
    // One open emergency at a time: close the first before queuing a second offline event.
    await coordinator.resolveEmergency(first.eventId);
    await coordinator.triggerEmergency('user-1', 'device-1', EmergencyTriggerSource.GESTURE);

    const pendingCount = (await repository.getPendingSyncEvents()).length;
    expect(pendingCount).toBe(2);

    const all = await repository.getAllEvents();
    expect(all.every((e) => e.syncStatus === SyncStatus.PENDING)).toBe(true);
  });
});
