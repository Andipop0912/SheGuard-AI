import { LocationService } from '../../src/location/services/LocationService';
import {
  LocationAvailability,
  LocationPermissionStatus,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../../src/location/domain/LocationState';
import { parseLocationFix } from '../../src/location/domain/LocationFix';
import { FakeLocationNative, FakePermissions, fix, NOW, testPolicy } from './fakes';

function setup(permission = LocationPermissionStatus.GRANTED) {
  const native = new FakeLocationNative();
  const permissions = new FakePermissions(permission);
  const service = new LocationService(native, permissions, testPolicy, () => NOW);
  return { native, permissions, service };
}

describe('LocationService', () => {
  test('1. initial state is UNAVAILABLE with no fix and nothing checked yet', () => {
    const { service } = setup();
    const readiness = service.getReadiness();
    expect(readiness.availability).toBe(LocationAvailability.UNAVAILABLE);
    expect(readiness.fix).toBeNull();
    expect(readiness.checkedAt).toBeNull();
    expect(service.getTrackingState()).toBe(LocationTrackingState.IDLE);
  });

  test('2. permission denied → PERMISSION_DENIED, no fix requested', async () => {
    const { service, native, permissions } = setup(LocationPermissionStatus.UNDETERMINED);
    permissions.requestResult = LocationPermissionStatus.DENIED;
    native.lastKnown = fix();

    expect((await service.refreshReadiness()).availability).toBe(LocationAvailability.PERMISSION_REQUIRED);

    const readiness = await service.requestPermission();
    expect(readiness.availability).toBe(LocationAvailability.PERMISSION_DENIED);
    expect(readiness.reason).toBe(LocationUnavailableReason.PERMISSION);
    expect(readiness.fix).toBeNull();
    expect(await service.acquireCurrentFix()).toBeNull();
    expect(native.currentCalls).toBe(0);
  });

  test('3. permission granted → readiness reflects the device state', async () => {
    const { service, permissions } = setup(LocationPermissionStatus.UNDETERMINED);
    permissions.requestResult = LocationPermissionStatus.GRANTED;

    const readiness = await service.requestPermission();
    expect(readiness.permission).toBe(LocationPermissionStatus.GRANTED);
    expect(readiness.servicesEnabled).toBe(true);
  });

  test('4. a fresh fix → AVAILABLE', async () => {
    const { service, native } = setup();
    native.current = fix({ timestamp: NOW - 1_000 });

    const acquired = await service.acquireCurrentFix();
    expect(acquired).toEqual(native.current);
    expect(service.getReadiness().availability).toBe(LocationAvailability.AVAILABLE);
  });

  test('5. no fix at all → UNAVAILABLE (NO_FIX), or SERVICES_DISABLED when location is off', async () => {
    const { service, native } = setup();
    expect((await service.refreshReadiness()).reason).toBe(LocationUnavailableReason.NO_FIX);
    expect(await service.acquireCurrentFix()).toBeNull();
    expect(service.getReadiness().availability).toBe(LocationAvailability.UNAVAILABLE);

    native.servicesEnabled = false;
    expect((await service.refreshReadiness()).reason).toBe(LocationUnavailableReason.SERVICES_DISABLED);
    expect((await service.getBestAvailableFixNow()).kind).toBe('NONE');
  });

  test('6. an old last-known fix → STALE', async () => {
    const { service, native } = setup();
    native.lastKnown = fix({ timestamp: NOW - 10 * 60_000, isLastKnown: true });

    const readiness = await service.refreshReadiness();
    expect(readiness.availability).toBe(LocationAvailability.STALE);
    expect((await service.getBestAvailableFixNow()).kind).toBe('STALE');
  });

  test('7. a fresh fix is preferred over an older stale one', async () => {
    const { service, native } = setup();
    native.lastKnown = fix({ timestamp: NOW - 10 * 60_000, latitude: 10 });
    native.current = fix({ timestamp: NOW - 1_000, latitude: 20 });

    await service.acquireCurrentFix();
    const best = await service.getBestAvailableFixNow();

    expect(best.kind).toBe('FRESH');
    expect(best.kind !== 'NONE' && best.fix.latitude).toBe(20);
  });

  test('14/15. duplicate start and duplicate stop are safe', async () => {
    const { service, native } = setup();
    await Promise.all([service.startTracking(), service.startTracking(), service.startTracking()]);
    expect(native.startCalls).toBe(1);
    expect(service.getTrackingState()).toBe(LocationTrackingState.ACTIVE);

    await Promise.all([service.stopTracking(), service.stopTracking()]);
    await service.stopTracking();
    expect(native.stopCalls).toBe(1);
    expect(service.getTrackingState()).toBe(LocationTrackingState.IDLE);
  });

  test('start immediately followed by stop leaves tracking off', async () => {
    const { service, native } = setup();
    const start = service.startTracking();
    const stop = service.stopTracking();
    await Promise.all([start, stop]);
    expect(native.tracking).toBe(false);
    expect(service.getTrackingState()).toBe(LocationTrackingState.IDLE);
  });

  test('tracking that the platform refuses is reported as FAILED with its reason', async () => {
    const { service, native } = setup();
    native.startResult = { ok: false, reason: 'FOREGROUND_START_NOT_ALLOWED' };
    await service.startTracking();
    expect(service.getTrackingState()).toBe(LocationTrackingState.FAILED);
    expect(service.getTrackingFailureReason()).toBe('FOREGROUND_START_NOT_ALLOWED');
  });

  test('18. invalid native data is rejected, never repaired into coordinates', () => {
    expect(parseLocationFix(null)).toBeNull();
    expect(parseLocationFix({ latitude: 91, longitude: 0, timestamp: NOW })).toBeNull();
    expect(parseLocationFix({ latitude: 0, longitude: 181, timestamp: NOW })).toBeNull();
    expect(parseLocationFix({ latitude: NaN, longitude: 0, timestamp: NOW })).toBeNull();
    expect(parseLocationFix({ latitude: 1, longitude: 1 })).toBeNull(); // no timestamp
    expect(parseLocationFix({ latitude: '19', longitude: 72, timestamp: NOW })).toBeNull();

    const valid = parseLocationFix({ latitude: 19.07, longitude: 72.87, timestamp: NOW, accuracyMeters: -5 });
    expect(valid?.accuracyMeters).toBeNull(); // bad optional field dropped, not invented
  });

  test('unsupported platform (no native module) is UNAVAILABLE and does not throw', async () => {
    const { service, native } = setup();
    native.supported = false;
    const readiness = await service.refreshReadiness();
    expect(readiness.availability).toBe(LocationAvailability.UNAVAILABLE);
    expect(readiness.reason).toBe(LocationUnavailableReason.NOT_SUPPORTED);
  });
});
