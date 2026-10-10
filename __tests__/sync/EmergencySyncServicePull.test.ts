import { EmergencySyncService } from '../../src/sync/EmergencySyncService';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { ApiClient } from '../../src/api/ApiClient';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';

describe('EmergencySyncService - pullHistoricalEvents', () => {
  let repository: EmergencyStorageRepository;
  let coordinator: jest.Mocked<EmergencyCoordinator>;
  let api: jest.Mocked<ApiClient>;
  let sessionSource: any;
  let service: EmergencySyncService;
  let mockSession = { userId: 'user-1', deviceId: 'dev-1', phone: '123' };

  beforeEach(() => {
    repository = new EmergencyStorageRepository();
    coordinator = { subscribeActiveEvent: jest.fn() } as any;
    api = {
      isConfigured: jest.fn().mockReturnValue(true),
      authorizedRequest: jest.fn(),
    } as any;
    
    // Allow tests to trigger subscribe manually
    let listener: any = null;
    sessionSource = {
      getSession: () => mockSession,
      subscribe: (l: any) => {
        listener = l;
        return () => {};
      },
      triggerAuthChange: (session: any) => {
        mockSession = session;
        if (listener) listener({ session });
      }
    };

    service = new EmergencySyncService(repository, coordinator, api, sessionSource);
    service.start();
  });

  afterEach(() => {
    service.dispose();
  });

  test('1. Pull returns historical events and 2. persists them locally', async () => {
    api.authorizedRequest.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          eventId: 'evt-1',
          userId: 'user-1',
          deviceId: 'dev-2', // from another device
          triggerSource: EmergencyTriggerSource.MANUAL_SOS,
          state: EmergencyState.RESOLVED,
          createdAt: 1000,
          updatedAt: 2000,
          resolvedAt: 2000,
          metadata: {}
        }
      ]
    } as any);

    await service.pullHistoricalEvents();

    const stored = await repository.getEvent('evt-1');
    expect(stored).toBeDefined();
    expect(stored!.syncStatus).toBe(SyncStatus.SYNCED);
    expect(stored!.state).toBe(EmergencyState.RESOLVED);
  });

  test('3, 4. Existing local event is not duplicated', async () => {
    await repository.saveEvent({
      eventId: 'evt-2',
      userId: 'user-1',
      deviceId: 'dev-1',
      triggerSource: EmergencyTriggerSource.MANUAL_SOS,
      state: EmergencyState.RESOLVED,
      createdAt: 1000,
      updatedAt: 2000,
      resolvedAt: 2000,
      syncStatus: SyncStatus.SYNCED,
      syncedAt: 2000,
      syncError: null
    });

    api.authorizedRequest.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          eventId: 'evt-2',
          userId: 'user-1',
          deviceId: 'dev-1',
          triggerSource: EmergencyTriggerSource.MANUAL_SOS,
          state: EmergencyState.RESOLVED,
          createdAt: 1000,
          updatedAt: 2000,
          resolvedAt: 2000,
          metadata: {}
        }
      ]
    } as any);

    await service.pullHistoricalEvents();

    const events = await repository.getAllEvents();
    expect(events.length).toBe(1); // No duplicates
  });

  test('5. Newer server state can update local synced event', async () => {
    await repository.saveEvent({
      eventId: 'evt-3',
      userId: 'user-1',
      deviceId: 'dev-1',
      triggerSource: EmergencyTriggerSource.VOICE,
      state: EmergencyState.TRIGGERED,
      createdAt: 1000,
      updatedAt: 1000,
      resolvedAt: null,
      syncStatus: SyncStatus.SYNCED,
      syncedAt: 1000,
      syncError: null
    });

    api.authorizedRequest.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          eventId: 'evt-3', // Same event
          userId: 'user-1',
          deviceId: 'dev-1',
          triggerSource: EmergencyTriggerSource.VOICE,
          state: EmergencyState.RESOLVED, // Newer state!
          createdAt: 1000,
          updatedAt: 3000, // Newer timestamp
          resolvedAt: 3000,
          metadata: {}
        }
      ]
    } as any);

    await service.pullHistoricalEvents();

    const stored = await repository.getEvent('evt-3');
    expect(stored!.state).toBe(EmergencyState.RESOLVED);
    expect(stored!.updatedAt).toBe(3000);
  });

  test('6. Newer local pending state is protected', async () => {
    // A locally modified event waiting to be uploaded
    await repository.saveEvent({
      eventId: 'evt-4',
      userId: 'user-1',
      deviceId: 'dev-1',
      triggerSource: EmergencyTriggerSource.GESTURE,
      state: EmergencyState.RESOLVED,
      createdAt: 1000,
      updatedAt: 4000, // Very new local edit
      resolvedAt: 4000,
      syncStatus: SyncStatus.PENDING, // PENDING protects it from being overwritten
      syncedAt: 1000,
      syncError: null
    });

    api.authorizedRequest.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          eventId: 'evt-4',
          userId: 'user-1',
          deviceId: 'dev-1',
          triggerSource: EmergencyTriggerSource.GESTURE,
          state: EmergencyState.TRIGGERED, // Stale server state
          createdAt: 1000,
          updatedAt: 1000,
          resolvedAt: null,
          metadata: {}
        }
      ]
    } as any);

    await service.pullHistoricalEvents();

    const stored = await repository.getEvent('evt-4');
    expect(stored!.state).toBe(EmergencyState.RESOLVED); // Remains resolved
    expect(stored!.syncStatus).toBe(SyncStatus.PENDING); // Remains pending
  });

  test('9. Offline pull failure does not break login', async () => {
    api.authorizedRequest.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'NETWORK' }
    } as any);

    // Should not throw
    await expect(service.pullHistoricalEvents()).resolves.toBeUndefined();
  });

  test('11. Pull after session restore works', async () => {
    // Spy on pullHistoricalEvents
    const pullSpy = jest.spyOn(service, 'pullHistoricalEvents').mockResolvedValue(undefined);
    
    // Simulate session restore
    sessionSource.triggerAuthChange({ userId: 'user-2', deviceId: 'dev-2', phone: '456' });

    expect(pullSpy).toHaveBeenCalled();
  });
});
