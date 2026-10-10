import { AppState } from 'react-native';
import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { LocationService } from '../../src/location/services/LocationService';
import { EmergencyLocationController } from '../../src/location/services/EmergencyLocationController';
import {
  EmergencyLocationRepository,
  LocationPointKind,
} from '../../src/location/storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../../src/location/sync/LocationSyncQueue';
import { DisconnectedLocationSyncTransport } from '../../src/location/sync/LocationSyncTransport';
import {
  EmergencyLocationStatus,
  LocationPermissionStatus,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../../src/location/domain/LocationState';
import { AppContainer } from '../../src/app/di/AppContainer';
import { teardownLocationStoreForTesting, useLocationStore } from '../../src/location/store/locationStore';
import { FakeLocationNative, FakePermissions, fix, NOW, settle, testPolicy } from './fakes';

/**
 * Regression for the device-observed bug (evt-b4ad81f8): an emergency opened while location
 * permission was denied stayed UNAVAILABLE(PERMISSION) with tracking IDLE after permission was granted.
 */
function setup() {
  const native = new FakeLocationNative();
  native.lastKnown = fix({ timestamp: NOW - 3_000 });
  const permissions = new FakePermissions(LocationPermissionStatus.DENIED);
  const service = new LocationService(native, permissions, testPolicy, () => NOW);
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const locationRepository = new EmergencyLocationRepository(testPolicy.maxPointsPerEmergency, () => NOW);
  const queue = new LocationSyncQueue(locationRepository, new DisconnectedLocationSyncTransport(), testPolicy);
  const controller = new EmergencyLocationController(coordinator, service, locationRepository, queue);
  controller.start();
  return { native, permissions, service, coordinator, emergencyRepository, locationRepository, controller };
}

describe('Permission granted while an emergency is already open', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1–2. emergency opened while denied → UNAVAILABLE(PERMISSION), tracking IDLE', async () => {
    const { coordinator, controller, native } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();

    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.UNAVAILABLE);
    expect(controller.getState()?.reason).toBe(LocationUnavailableReason.PERMISSION);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.IDLE);
    expect(native.startCalls).toBe(0);
  });

  test('3–7. permission granted → controller notices, snapshot + tracking start exactly once; emergency unchanged', async () => {
    const { coordinator, controller, native, permissions, service, locationRepository, emergencyRepository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();

    // User grants permission (in-app prompt or Settings → app foregrounded → readiness refreshed).
    permissions.status = LocationPermissionStatus.GRANTED;
    await service.refreshReadiness();
    await settle();

    expect(native.startCalls).toBe(1);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.ACTIVE);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.AVAILABLE);
    const points = await locationRepository.getPoints(event.eventId);
    expect(points.map((p) => p.kind)).toEqual([LocationPointKind.SNAPSHOT]);

    // Further readiness refreshes / fixes must not restart tracking or re-snapshot.
    await service.refreshReadiness();
    await service.refreshReadiness();
    native.emitUpdate(fix({ timestamp: NOW - 100 }));
    await settle();
    expect(native.startCalls).toBe(1);
    expect((await locationRepository.getPoints(event.eventId)).filter((p) => p.kind === LocationPointKind.SNAPSHOT))
      .toHaveLength(1);

    // The emergency itself is untouched and still the only one.
    const events = await emergencyRepository.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(event.eventId);
    expect(events[0].state).toBe(EmergencyState.RESPONDING);
  });

  test('concurrent readiness emissions recover only once', async () => {
    const { coordinator, native, permissions, service, locationRepository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.GESTURE);
    await settle();

    permissions.status = LocationPermissionStatus.GRANTED;
    await Promise.all([service.refreshReadiness(), service.refreshReadiness(), service.refreshReadiness()]);
    await settle();

    expect(native.startCalls).toBe(1);
    expect(await locationRepository.getPoints(event.eventId)).toHaveLength(1);
  });

  test('8. after permission recovery, resolve still stops tracking', async () => {
    const { coordinator, native, permissions, service, controller } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();
    permissions.status = LocationPermissionStatus.GRANTED;
    await service.refreshReadiness();
    await settle();

    await coordinator.resolveEmergency(event.eventId);
    await settle();

    expect(native.tracking).toBe(false);
    expect(native.stopCalls).toBe(1);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.IDLE);
  });

  test('9. permission still denied → stays UNAVAILABLE, nothing starts', async () => {
    const { coordinator, controller, native, service } = setup();
    await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();

    await service.refreshReadiness();
    await service.refreshReadiness();
    await settle();

    expect(native.startCalls).toBe(0);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.UNAVAILABLE);
  });

  test('10. a permission grant with no open emergency creates nothing and tracks nothing', async () => {
    const { native, permissions, service, emergencyRepository, controller } = setup();
    permissions.status = LocationPermissionStatus.GRANTED;
    await service.refreshReadiness();
    await settle();

    expect(await emergencyRepository.getAllEvents()).toHaveLength(0);
    expect(native.startCalls).toBe(0);
    expect(controller.getState()).toBeNull();
  });

  test('a grant after the emergency was resolved does not start tracking', async () => {
    const { coordinator, native, permissions, service } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();
    await coordinator.resolveEmergency(event.eventId);
    await settle();

    permissions.status = LocationPermissionStatus.GRANTED;
    await service.refreshReadiness();
    await settle();

    expect(native.startCalls).toBe(0);
  });
});

describe('locationStore re-reads readiness when the app returns to the foreground', () => {
  afterEach(() => {
    teardownLocationStoreForTesting();
    AppContainer.resetForTesting();
    jest.restoreAllMocks();
  });

  test('AppState "active" triggers refreshReadiness; the listener is removed on teardown', async () => {
    let appStateHandler: ((status: string) => void) | null = null;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (status: string) => void) => {
      appStateHandler = handler;
      return { remove };
    }) as unknown as typeof AppState.addEventListener);

    AppContainer.resetForTesting();
    const refresh = jest.spyOn(AppContainer.getInstance().locationService, 'refreshReadiness');
    await useLocationStore.getState().initialize();
    refresh.mockClear();

    appStateHandler!('background');
    expect(refresh).not.toHaveBeenCalled();
    appStateHandler!('active');
    expect(refresh).toHaveBeenCalledTimes(1);

    teardownLocationStoreForTesting();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
