import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { LocationService } from '../../src/location/services/LocationService';
import { EmergencyLocationController } from '../../src/location/services/EmergencyLocationController';
import { EmergencyLocationRepository, LocationPointKind } from '../../src/location/storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../../src/location/sync/LocationSyncQueue';
import { DisconnectedLocationSyncTransport } from '../../src/location/sync/LocationSyncTransport';
import {
  EmergencyLocationStatus,
  LocationPermissionStatus,
  LocationTrackingState,
} from '../../src/location/domain/LocationState';
import { LocationFix } from '../../src/location/domain/LocationFix';
import { FakeLocationNative, FakePermissions, fix, NOW, settle, testPolicy } from './fakes';

/**
 * Device-observed (evt-bfd9d91a): a VOICE emergency triggered with the app in the background.
 * Android refused the location foreground service (SecurityException), tracking became FAILED,
 * and it stayed FAILED after the app returned to the foreground.
 */
function setup(lastKnown: LocationFix | null = fix({ timestamp: NOW - 65_000 })) {
  const native = new FakeLocationNative();
  native.lastKnown = lastKnown;
  native.current = null; // while-in-use permission gives no fix from the background
  native.startResult = { ok: false, reason: 'FOREGROUND_START_NOT_ALLOWED' };
  const permissions = new FakePermissions(LocationPermissionStatus.GRANTED);
  const service = new LocationService(native, permissions, testPolicy, () => NOW);
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const locationRepository = new EmergencyLocationRepository(testPolicy.maxPointsPerEmergency, () => NOW);
  const queue = new LocationSyncQueue(locationRepository, new DisconnectedLocationSyncTransport(), testPolicy);
  const controller = new EmergencyLocationController(coordinator, service, locationRepository, queue);
  controller.start();
  return { native, service, coordinator, emergencyRepository, locationRepository, controller };
}

/** The app returning to the foreground: Android now allows the service; AppState triggers a refresh. */
async function returnToForeground(native: FakeLocationNative, service: LocationService) {
  native.startResult = { ok: true };
  await service.refreshReadiness();
  await settle();
}

describe('Tracking refused in the background recovers when the app returns to the foreground', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('background trigger: emergency created, snapshot attached, tracking FAILED (as on device)', async () => {
    const { coordinator, controller, locationRepository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();

    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.FAILED);
    expect(controller.getState()?.trackingFailureReason).toBe('FOREGROUND_START_NOT_ALLOWED');
    expect((await locationRepository.getPoints(event.eventId)).map((p) => p.kind)).toEqual([LocationPointKind.SNAPSHOT]);
  });

  test('returning to the foreground starts tracking exactly once, without a second snapshot', async () => {
    const { coordinator, controller, native, service, locationRepository, emergencyRepository } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();
    const startsWhileBackground = native.startCalls;

    await returnToForeground(native, service);

    expect(native.startCalls).toBe(startsWhileBackground + 1);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.ACTIVE);

    native.emitUpdate(fix({ timestamp: NOW - 100 }));
    await service.refreshReadiness(); // further foregrounds while ACTIVE: no restart
    await service.refreshReadiness();
    await settle();

    expect(native.startCalls).toBe(startsWhileBackground + 1);
    const points = await locationRepository.getPoints(event.eventId);
    expect(points.filter((p) => p.kind === LocationPointKind.SNAPSHOT)).toHaveLength(1);
    expect(points.filter((p) => p.kind === LocationPointKind.UPDATE)).toHaveLength(1);
    expect(await emergencyRepository.getAllEvents()).toHaveLength(1);
  });

  test('also recovers when the background snapshot found no fix at all (status PENDING)', async () => {
    const { coordinator, controller, native, service } = setup(null);
    await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.PENDING);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.FAILED);

    await returnToForeground(native, service);

    expect(controller.getState()?.tracking).toBe(LocationTrackingState.ACTIVE);
  });

  test('persistent refusal: one retry per foreground/refresh, never a loop', async () => {
    const { coordinator, native, service } = setup();
    await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();
    const before = native.startCalls;

    await service.refreshReadiness(); // still refused
    await settle();
    await service.refreshReadiness(); // still refused
    await settle();

    expect(native.startCalls).toBe(before + 2);
  });

  test('no retry after the emergency is resolved', async () => {
    const { coordinator, native, service } = setup();
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.VOICE);
    await settle();
    await coordinator.resolveEmergency(event.eventId);
    await settle();
    const before = native.startCalls;

    await returnToForeground(native, service);

    expect(native.startCalls).toBe(before);
    expect(native.tracking).toBe(false);
  });
});
