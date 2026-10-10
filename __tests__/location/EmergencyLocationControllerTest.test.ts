import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState, isOpenEmergencyState } from '../../src/emergency/domain/EmergencyState';
import { LocationService } from '../../src/location/services/LocationService';
import { EmergencyLocationController } from '../../src/location/services/EmergencyLocationController';
import {
  EmergencyLocationRepository,
  LocationPointKind,
  LocationSyncStatus,
} from '../../src/location/storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../../src/location/sync/LocationSyncQueue';
import { DisconnectedLocationSyncTransport } from '../../src/location/sync/LocationSyncTransport';
import {
  EmergencyLocationStatus,
  LocationPermissionStatus,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../../src/location/domain/LocationState';
import { FakeLocationNative, FakePermissions, fix, NOW, settle, testPolicy } from './fakes';

const { MANUAL_SOS, VOICE, GESTURE, HARDWARE_BUTTON } = EmergencyTriggerSource;

function setup(permission = LocationPermissionStatus.GRANTED) {
  const native = new FakeLocationNative();
  const permissions = new FakePermissions(permission);
  const service = new LocationService(native, permissions, testPolicy, () => NOW);
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const locationRepository = new EmergencyLocationRepository(testPolicy.maxPointsPerEmergency, () => NOW);
  const queue = new LocationSyncQueue(locationRepository, new DisconnectedLocationSyncTransport(), testPolicy);
  const controller = new EmergencyLocationController(coordinator, service, locationRepository, queue);
  controller.start();
  return { native, permissions, service, coordinator, emergencyRepository, locationRepository, queue, controller };
}

describe('EmergencyLocationController (location linked to the emergency lifecycle)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('8. emergency without any location is still created immediately (status PENDING / UNAVAILABLE)', async () => {
    const { coordinator, controller, native } = setup();
    native.lastKnown = null;
    native.current = null;

    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    expect(event.state).toBe(EmergencyState.RESPONDING);

    await settle();
    expect(controller.getState()?.eventId).toBe(event.eventId);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.PENDING);
    expect(controller.getState()?.latestFix).toBeNull();
  });

  test('8b. permission denied: emergency created; location UNAVAILABLE(PERMISSION); no tracking started', async () => {
    const { coordinator, controller, native } = setup(LocationPermissionStatus.DENIED);
    native.lastKnown = fix();

    const event = await coordinator.triggerEmergency('u', 'd', VOICE);
    await settle();

    expect(event.state).toBe(EmergencyState.RESPONDING);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.UNAVAILABLE);
    expect(controller.getState()?.reason).toBe(LocationUnavailableReason.PERMISSION);
    expect(native.startCalls).toBe(0);
  });

  test('SOS never waits for GPS: the emergency resolves before a slow location call finishes', async () => {
    const { coordinator, native } = setup();
    let releaseLastKnown: () => void = () => {};
    native.getLastKnownLocation = () =>
      new Promise((resolve) => {
        releaseLastKnown = () => resolve(fix());
      });

    const event = await coordinator.triggerEmergency('u', 'd', GESTURE);
    expect(event.state).toBe(EmergencyState.RESPONDING); // resolved while location is still pending

    releaseLastKnown();
    await settle();
  });

  test('9. a fresh fix is attached as the emergency SNAPSHOT (AVAILABLE)', async () => {
    const { coordinator, controller, locationRepository, native } = setup();
    native.lastKnown = fix({ timestamp: NOW - 2_000 });

    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    const points = await locationRepository.getPoints(event.eventId);
    expect(points).toHaveLength(1);
    expect(points[0].kind).toBe(LocationPointKind.SNAPSHOT);
    expect(points[0].fix.latitude).toBe(19.076);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.AVAILABLE);
  });

  test('9b. only an old last-known fix: attached with its real timestamp and marked STALE', async () => {
    const { coordinator, controller, locationRepository, native } = setup();
    const old = fix({ timestamp: NOW - 30 * 60_000, isLastKnown: true });
    native.lastKnown = old;

    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    const [snapshot] = await locationRepository.getPoints(event.eventId);
    expect(snapshot.fix.timestamp).toBe(old.timestamp);
    expect(snapshot.fix.isLastKnown).toBe(true);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.STALE);
  });

  test('11. an active emergency starts controlled tracking; updates are stored as UPDATE points', async () => {
    const { coordinator, controller, locationRepository, native } = setup();
    native.lastKnown = fix();

    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();
    expect(native.startCalls).toBe(1);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.ACTIVE);

    native.emitUpdate(fix({ timestamp: NOW - 100, latitude: 19.08 }));
    await settle();

    const points = await locationRepository.getPoints(event.eventId);
    expect(points.map((p) => p.kind)).toEqual([LocationPointKind.SNAPSHOT, LocationPointKind.UPDATE]);
    expect(controller.getState()?.latestFix?.latitude).toBe(19.08);
    expect(controller.getState()?.pointCount).toBe(2);
  });

  test('12. RESOLVED stops tracking; later fixes are not recorded against the emergency', async () => {
    const { coordinator, controller, locationRepository, native } = setup();
    native.lastKnown = fix();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    await coordinator.resolveEmergency(event.eventId);
    await settle();

    expect(native.tracking).toBe(false);
    expect(native.stopCalls).toBe(1);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.IDLE);

    native.emitUpdate(fix({ timestamp: NOW }));
    await settle();
    expect(await locationRepository.getPoints(event.eventId)).toHaveLength(1);
  });

  test('13. CANCELLED stops tracking', async () => {
    const { coordinator, native } = setup();
    native.lastKnown = fix();
    const event = await coordinator.triggerEmergency('u', 'd', VOICE);
    await settle();

    await coordinator.cancelEmergency(event.eventId);
    await settle();

    expect(native.tracking).toBe(false);
    expect(native.stopCalls).toBe(1);
  });

  test('tracking refused by the platform falls back to one direct fix; the emergency is unaffected', async () => {
    const { coordinator, controller, locationRepository, native } = setup();
    native.lastKnown = null;
    native.current = fix({ timestamp: NOW - 500 });
    native.startResult = { ok: false, reason: 'FOREGROUND_START_NOT_ALLOWED' };

    const event = await coordinator.triggerEmergency('u', 'd', VOICE);
    await settle();

    expect(coordinator.getCurrentActiveEvent()?.state).toBe(EmergencyState.RESPONDING);
    expect(controller.getState()?.tracking).toBe(LocationTrackingState.FAILED);
    expect(controller.getState()?.trackingFailureReason).toBe('FOREGROUND_START_NOT_ALLOWED');
    expect(await locationRepository.getPoints(event.eventId)).toHaveLength(1);
    expect(controller.getState()?.status).toBe(EmergencyLocationStatus.AVAILABLE);
  });

  test('10. offline: points stay locally available and PENDING (transport not connected)', async () => {
    const { coordinator, locationRepository, queue, native } = setup();
    native.lastKnown = fix();
    const event = await coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    const [point] = await locationRepository.getPoints(event.eventId);
    expect(point.syncStatus).toBe(LocationSyncStatus.PENDING);
    expect(queue.getState().kind).toBe('NOT_CONNECTED');

    // Survives a restart: a fresh repository over the same storage still has it.
    const reloaded = new EmergencyLocationRepository(testPolicy.maxPointsPerEmergency);
    expect((await reloaded.getPoints(event.eventId)).map((p) => p.locationId)).toEqual([point.locationId]);
  });

  test('19. location activity never creates an emergency', async () => {
    const { emergencyRepository, native, service } = setup();
    native.lastKnown = fix();
    native.current = fix();

    await service.refreshReadiness();
    await service.acquireCurrentFix();
    await service.startTracking();
    native.emitUpdate(fix({ timestamp: NOW }));
    await settle();

    expect(await emergencyRepository.getAllEvents()).toHaveLength(0);
  });

  test('20. single-open-emergency invariant intact: concurrent triggers → one emergency, one snapshot, one tracker', async () => {
    const { coordinator, locationRepository, emergencyRepository, native } = setup();
    native.lastKnown = fix();

    const results = await Promise.all([
      coordinator.triggerEmergency('u', 'd', MANUAL_SOS),
      coordinator.triggerEmergency('u', 'd', VOICE),
      coordinator.triggerEmergency('u', 'd', GESTURE),
      coordinator.triggerEmergency('u', 'd', HARDWARE_BUTTON),
    ]);
    await settle();

    expect(new Set(results.map((e) => e.eventId)).size).toBe(1);
    const open = (await emergencyRepository.getAllEvents()).filter((e) => isOpenEmergencyState(e.state));
    expect(open).toHaveLength(1);
    expect(await locationRepository.getPoints(results[0].eventId)).toHaveLength(1);
    expect(native.startCalls).toBe(1);
  });

  test('a restored emergency resumes tracking without taking a second snapshot', async () => {
    const first = setup();
    first.native.lastKnown = fix();
    const event = await first.coordinator.triggerEmergency('u', 'd', MANUAL_SOS);
    await settle();

    // New runtime over the same storage.
    const second = setup();
    second.native.lastKnown = fix({ timestamp: NOW - 1_000 });
    await second.coordinator.restoreActiveEvent();
    await settle();

    expect(second.controller.getState()?.eventId).toBe(event.eventId);
    expect(second.native.startCalls).toBe(1);
    expect(await second.locationRepository.getPoints(event.eventId)).toHaveLength(1);
  });
});
