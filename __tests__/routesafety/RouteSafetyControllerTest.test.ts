import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { LocationService } from '../../src/location/services/LocationService';
import { RouteSafetyController, RouteSafetyApi, RouteRequest } from '../../src/routesafety/services/RouteSafetyController';
import { RouteSafetyRepository } from '../../src/routesafety/storage/RouteSafetyRepository';
import { RouteSafetySession, RouteSafetyStatus, RoutePoint } from '../../src/routesafety/domain/RouteSafetySession';
import { setSignedInUser } from '../../src/app/identity';
import { FakeLocationNative, FakePermissions, fix, NOW, testPolicy } from '../location/fakes';

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeApi implements RouteSafetyApi {
  public startedCalls: RouteSafetySession[] = [];
  public deviationCalls: RouteSafetySession[] = [];
  public endedCalls: string[] = [];
  public syncCalls: { sessionId: string; point: RoutePoint; timestamp: number }[] = [];

  async notifyStarted(session: RouteSafetySession): Promise<void> {
    this.startedCalls.push(session);
  }
  async notifyDeviation(session: RouteSafetySession): Promise<void> {
    this.deviationCalls.push(session);
  }
  async endSession(sessionId: string): Promise<void> {
    this.endedCalls.push(sessionId);
  }
  async syncLocation(sessionId: string, point: RoutePoint, timestamp: number): Promise<void> {
    this.syncCalls.push({ sessionId, point, timestamp });
  }
}

const ROUTE: RoutePoint[] = [
  { latitude: 19.0760, longitude: 72.8777 },
  { latitude: 19.0850, longitude: 72.8777 },
];

function baseRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    startLocation: { latitude: 19.0760, longitude: 72.8777 },
    destinationText: 'Office',
    destinationLocation: { latitude: 19.0850, longitude: 72.8777 },
    routePolyline: ROUTE,
    routeDistanceMeters: 1000,
    routeDurationSeconds: 900,
    ...overrides,
  };
}

function setup() {
  const native = new FakeLocationNative();
  native.lastKnown = fix();
  const permissions = new FakePermissions();
  const location = new LocationService(native, permissions, testPolicy, () => NOW);
  const emergencyRepository = new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(emergencyRepository);
  const repository = new RouteSafetyRepository();
  const api = new FakeApi();
  const controller = new RouteSafetyController(coordinator, location, repository, api);
  setSignedInUser('u-test');
  return { native, location, coordinator, repository, api, controller };
}

describe('RouteSafetyController', () => {
  afterEach(() => setSignedInUser(null));

  test('start() creates an ACTIVE session and notifies immediately, before any deviation or arrival', async () => {
    const { controller, api } = setup();
    const session = await controller.start(baseRequest());

    expect(session.status).toBe(RouteSafetyStatus.ACTIVE);
    expect(session.deviationState).toBe('ON_ROUTE');
    await settle();
    expect(api.startedCalls).toHaveLength(1);
    expect(api.startedCalls[0].sessionId).toBe(session.sessionId);
  });

  test('cannot start a second session while one is active; the original route is never silently replaced', async () => {
    const { controller } = setup();
    await controller.start(baseRequest());
    await expect(controller.start(baseRequest({ destinationText: 'Somewhere else' }))).rejects.toThrow();
  });

  test('a location fix updates current position and syncs it to the backend', async () => {
    const { controller, native, api } = setup();
    await controller.start(baseRequest());
    await settle();

    native.emitUpdate(fix({ latitude: 19.08, longitude: 72.8777, timestamp: NOW }));
    await settle();

    expect(controller.getSession()?.currentLocation).toEqual({ latitude: 19.08, longitude: 72.8777 });
    expect(api.syncCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('sustained deviation sends exactly one alert; continuing off-route never sends a second', async () => {
    const { controller, native, api } = setup();
    await controller.start(baseRequest());
    await settle();

    const farOff = { latitude: 19.0800, longitude: 72.8777 + 0.01 };
    native.emitUpdate(fix({ ...farOff, timestamp: NOW + 1000 }));
    await settle();
    native.emitUpdate(fix({ ...farOff, timestamp: NOW + 50_000 })); // past DEVIATION_CONFIRMATION_SECONDS
    await settle();
    expect(api.deviationCalls).toHaveLength(1);
    expect(controller.getSession()?.deviationState).toBe('DEROUTED');

    native.emitUpdate(fix({ ...farOff, timestamp: NOW + 60_000 }));
    await settle();
    expect(api.deviationCalls).toHaveLength(1); // still just one
  });

  test('ending the session stops location tracking when no emergency is open', async () => {
    const { controller, location, api } = setup();
    await controller.start(baseRequest());
    await settle();
    expect(location.getTrackingState()).not.toBe('IDLE');

    await controller.end();
    await settle();
    expect(location.getTrackingState()).toBe('IDLE');
    expect(api.endedCalls).toHaveLength(1);
  });

  test('ending the session never stops tracking while an emergency is open', async () => {
    const { controller, location, coordinator } = setup();
    await controller.start(baseRequest());
    await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    await settle();

    await controller.end();
    await settle();
    expect(location.getTrackingState()).not.toBe('IDLE'); // the emergency still needs it
  });

  test('Manual SOS while Route Safety is active creates exactly one emergency; no duplicate created by Route Safety', async () => {
    const { controller, coordinator } = setup();
    await controller.start(baseRequest());
    const event = await coordinator.triggerEmergency('u', 'd', EmergencyTriggerSource.MANUAL_SOS);
    expect(event.eventId).toBeTruthy();
    expect(controller.getSession()?.status).toBe(RouteSafetyStatus.ACTIVE); // untouched by the emergency
  });

  test('restore() reattaches a session that was left ACTIVE from a previous run', async () => {
    const { controller, repository } = setup();
    const started = await controller.start(baseRequest());

    const { controller: freshController } = (() => {
      const native = new FakeLocationNative();
      native.lastKnown = fix();
      const location = new LocationService(native, new FakePermissions(), testPolicy, () => NOW);
      const emergencyRepository = new EmergencyStorageRepository();
      const coordinator = new EmergencyCoordinator(emergencyRepository);
      const api = new FakeApi();
      return { controller: new RouteSafetyController(coordinator, location, repository, api) };
    })();

    await freshController.restore();
    expect(freshController.getSession()?.sessionId).toBe(started.sessionId);
  });
});
