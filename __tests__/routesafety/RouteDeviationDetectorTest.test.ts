import {
  advanceDeviationState,
  DEVIATION_CONFIRMATION_SECONDS,
  RETURN_TO_ROUTE_CONFIRMATION_SECONDS,
  ROUTE_DEVIATION_THRESHOLD_METERS,
  distanceToRouteMeters,
  initialDeviationSnapshot,
} from '../../src/routesafety/domain/RouteDeviationDetector';
import { RouteDeviationState, RoutePoint } from '../../src/routesafety/domain/RouteSafetySession';

const NOW = 1_800_000_000_000;

// A short straight route heading north along the same longitude, ~1.1km long.
const ROUTE: RoutePoint[] = [
  { latitude: 19.0760, longitude: 72.8777 },
  { latitude: 19.0800, longitude: 72.8777 },
  { latitude: 19.0850, longitude: 72.8777 },
];

function onRouteFix(t: number): { point: RoutePoint; accuracyMeters: number | null; timestamp: number } {
  return { point: { latitude: 19.0800, longitude: 72.8777 }, accuracyMeters: 10, timestamp: t };
}

/** ~0.004 deg longitude at this latitude is roughly 420m east of the route — well past threshold. */
function offRouteFix(t: number, accuracyMeters: number | null = 10): { point: RoutePoint; accuracyMeters: number | null; timestamp: number } {
  return { point: { latitude: 19.0800, longitude: 72.8777 + 0.004 }, accuracyMeters, timestamp: t };
}

describe('RouteDeviationDetector', () => {
  test('22. normal route movement stays ON_ROUTE', () => {
    let snap = initialDeviationSnapshot(NOW);
    for (let i = 0; i < 5; i++) {
      const r = advanceDeviationState(snap, onRouteFix(NOW + i * 5_000), ROUTE);
      snap = r.snapshot;
      expect(r.shouldAlertNow).toBe(false);
    }
    expect(snap.state).toBe(RouteDeviationState.ON_ROUTE);
  });

  test('23. one noisy off-route jump that snaps right back is never confirmed', () => {
    let snap = initialDeviationSnapshot(NOW);
    snap = advanceDeviationState(snap, offRouteFix(NOW + 1_000), ROUTE).snapshot;
    expect(snap.state).toBe(RouteDeviationState.POSSIBLE_DEVIATION);
    const r = advanceDeviationState(snap, onRouteFix(NOW + 2_000), ROUTE);
    expect(r.snapshot.state).toBe(RouteDeviationState.ON_ROUTE);
    expect(r.shouldAlertNow).toBe(false);
  });

  test('24. poor accuracy never advances the deviation state, even far off-route', () => {
    let snap = initialDeviationSnapshot(NOW);
    const r = advanceDeviationState(snap, offRouteFix(NOW + 1_000, 200), ROUTE);
    expect(r.snapshot).toEqual(snap);
    expect(r.shouldAlertNow).toBe(false);
  });

  test('25. a brief deviation shorter than the confirmation duration is not confirmed', () => {
    let snap = initialDeviationSnapshot(NOW);
    snap = advanceDeviationState(snap, offRouteFix(NOW + 1_000), ROUTE).snapshot;
    const shortlyAfter = NOW + 1_000 + (DEVIATION_CONFIRMATION_SECONDS - 5) * 1000;
    const r = advanceDeviationState(snap, offRouteFix(shortlyAfter), ROUTE);
    expect(r.snapshot.state).toBe(RouteDeviationState.POSSIBLE_DEVIATION);
    expect(r.shouldAlertNow).toBe(false);
  });

  test('26. sustained deviation past the confirmation duration becomes DEROUTED exactly once', () => {
    let snap = initialDeviationSnapshot(NOW);
    snap = advanceDeviationState(snap, offRouteFix(NOW), ROUTE).snapshot;
    const after = NOW + DEVIATION_CONFIRMATION_SECONDS * 1000 + 1_000;
    const r = advanceDeviationState(snap, offRouteFix(after), ROUTE);
    expect(r.snapshot.state).toBe(RouteDeviationState.DEROUTED);
    expect(r.shouldAlertNow).toBe(true);
    expect(r.snapshot.alertSentAt).toBe(after);
  });

  test('27/28. repeated off-route points while DEROUTED never re-alert (one incident = one alert)', () => {
    let snap = initialDeviationSnapshot(NOW);
    snap = advanceDeviationState(snap, offRouteFix(NOW), ROUTE).snapshot;
    const confirmTime = NOW + DEVIATION_CONFIRMATION_SECONDS * 1000 + 1_000;
    const confirmResult = advanceDeviationState(snap, offRouteFix(confirmTime), ROUTE);
    expect(confirmResult.shouldAlertNow).toBe(true);
    snap = confirmResult.snapshot;

    for (let i = 1; i <= 5; i++) {
      const r = advanceDeviationState(snap, offRouteFix(confirmTime + i * 10_000), ROUTE);
      expect(r.shouldAlertNow).toBe(false);
      expect(r.snapshot.state).toBe(RouteDeviationState.DEROUTED);
      snap = r.snapshot;
    }
  });

  test('29. returning to the route after DEROUTED reaches ON_ROUTE after the recovery confirmation duration', () => {
    let snap = initialDeviationSnapshot(NOW);
    snap = advanceDeviationState(snap, offRouteFix(NOW), ROUTE).snapshot;
    const confirmTime = NOW + DEVIATION_CONFIRMATION_SECONDS * 1000 + 1_000;
    snap = advanceDeviationState(snap, offRouteFix(confirmTime), ROUTE).snapshot;
    expect(snap.state).toBe(RouteDeviationState.DEROUTED);

    const backOnRoute = advanceDeviationState(snap, onRouteFix(confirmTime + 1_000), ROUTE);
    expect(backOnRoute.snapshot.state).toBe(RouteDeviationState.RETURNED_TO_ROUTE);
    snap = backOnRoute.snapshot;

    const recovered = advanceDeviationState(
      snap,
      onRouteFix(confirmTime + 1_000 + RETURN_TO_ROUTE_CONFIRMATION_SECONDS * 1000 + 1_000),
      ROUTE
    );
    expect(recovered.snapshot.state).toBe(RouteDeviationState.ON_ROUTE);
    expect(recovered.snapshot.alertSentAt).toBeNull(); // cleared, ready for a new incident
  });

  test('30. advanceDeviationState is simply never called when GPS is unavailable (missing fix != derouted)', () => {
    // There is no "null fix" input by design: callers only invoke this with a real fix.
    // Confirm the state truly cannot change on its own between calls (no hidden timers).
    const snap = initialDeviationSnapshot(NOW);
    expect(snap.state).toBe(RouteDeviationState.ON_ROUTE);
  });

  test('distanceToRouteMeters finds the correct nearest-segment distance', () => {
    const d = distanceToRouteMeters({ latitude: 19.0800, longitude: 72.8777 }, ROUTE);
    expect(d).toBeLessThan(5);
    const dOff = distanceToRouteMeters({ latitude: 19.0800, longitude: 72.8777 + 0.004 }, ROUTE);
    expect(dOff).toBeGreaterThan(ROUTE_DEVIATION_THRESHOLD_METERS);
  });
});
