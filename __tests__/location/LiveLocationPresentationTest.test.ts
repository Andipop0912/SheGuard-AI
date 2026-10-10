import { locationPolicy } from '../../src/config/locationPolicy';
import { describeAge, liveWindowMs, presentLiveLocation } from '../../src/location/live/liveLocationPresentation';
import {
  EmergencyLocationStatus,
  INITIAL_LOCATION_READINESS,
  LocationAvailability,
  LocationPermissionStatus,
  LocationReadiness,
  LocationTrackingState,
} from '../../src/location/domain/LocationState';
import { LocationFix, LocationProvider } from '../../src/location/domain/LocationFix';

const NOW = 1_800_000_000_000;
const fix = (ageMs: number, over: Partial<LocationFix> = {}): LocationFix => ({
  latitude: 19.0426,
  longitude: 73.0231,
  accuracyMeters: 12.4,
  altitudeMeters: null,
  speedMps: null,
  headingDegrees: null,
  timestamp: NOW - ageMs,
  provider: LocationProvider.FUSED,
  isLastKnown: false,
  ...over,
});
const ready = (f: LocationFix | null, over: Partial<LocationReadiness> = {}): LocationReadiness => ({
  ...INITIAL_LOCATION_READINESS,
  availability: f ? LocationAvailability.AVAILABLE : LocationAvailability.UNAVAILABLE,
  permission: LocationPermissionStatus.GRANTED,
  servicesEnabled: true,
  fix: f,
  checkedAt: NOW,
  ...over,
});
const input = (over: Partial<Parameters<typeof presentLiveLocation>[0]> = {}) => ({
  readiness: ready(fix(5_000)),
  tracking: LocationTrackingState.IDLE,
  emergencyLocation: null,
  openEmergencyId: null,
  sync: { kind: 'IDLE' as const, pending: 0 },
  now: NOW,
  policy: locationPolicy,
  ...over,
});

describe('Live Location freshness (derived from the existing locationPolicy)', () => {
  test('live window = 2 × emergency update interval (30 s); stale after 2 min', () => {
    expect(liveWindowMs(locationPolicy)).toBe(30_000);
    expect(locationPolicy.staleAfterMs).toBe(120_000);
  });

  test('LIVE only while tracking is ACTIVE and fixes are fresh', () => {
    expect(presentLiveLocation(input({ tracking: LocationTrackingState.ACTIVE, openEmergencyId: 'e' })).state).toBe('LIVE');
    // Tracking active but no fix for 45 s → not live.
    expect(
      presentLiveLocation(input({ tracking: LocationTrackingState.ACTIVE, readiness: ready(fix(45_000)), openEmergencyId: 'e' })).label
    ).toBe('Recent');
    // Fresh fix but no tracking (outside an emergency) → not live.
    expect(presentLiveLocation(input()).label).toBe('Recent');
  });

  test('STALE after staleAfterMs, with "Last updated"', () => {
    const p = presentLiveLocation(input({ readiness: ready(fix(5 * 60_000)) }));
    expect(p.state).toBe('STALE');
    expect(p.updatedText).toBe('Last updated 5 min ago');
  });

  test('accuracy is shown only when the platform reported it', () => {
    expect(presentLiveLocation(input()).accuracyText).toBe('±12 m');
    expect(presentLiveLocation(input({ readiness: ready(fix(5_000, { accuracyMeters: null })) })).accuracyText).toBeNull();
  });

  test('describeAge', () => {
    expect(describeAge(3_000)).toBe('3 s ago');
    expect(describeAge(150_000)).toBe('3 min ago');
  });
});

describe('Live Location states', () => {
  test('permission states and actions', () => {
    expect(presentLiveLocation(input({ readiness: ready(null, { permission: LocationPermissionStatus.UNDETERMINED }) }))).toMatchObject({
      state: 'PERMISSION_REQUIRED', action: 'REQUEST_PERMISSION',
    });
    expect(presentLiveLocation(input({ readiness: ready(null, { permission: LocationPermissionStatus.DENIED }) }))).toMatchObject({
      state: 'PERMISSION_DENIED', label: 'Permission denied', action: 'REQUEST_PERMISSION',
    });
    expect(presentLiveLocation(input({ readiness: ready(null, { permission: LocationPermissionStatus.BLOCKED }) }))).toMatchObject({
      state: 'PERMISSION_DENIED', label: 'Permission blocked', action: 'OPEN_SETTINGS',
    });
  });

  test('location services off → SERVICES_OFF with settings action', () => {
    expect(presentLiveLocation(input({ readiness: ready(null, { servicesEnabled: false }) }))).toMatchObject({
      state: 'SERVICES_OFF', action: 'OPEN_SETTINGS',
    });
  });

  test('no fix: UNAVAILABLE (refresh) vs ACQUIRING while tracking starts', () => {
    expect(presentLiveLocation(input({ readiness: ready(null) }))).toMatchObject({ state: 'UNAVAILABLE', action: 'REFRESH', fix: null });
    expect(
      presentLiveLocation(input({ readiness: ready(null), tracking: LocationTrackingState.STARTING, openEmergencyId: 'e' }))
    ).toMatchObject({ state: 'ACQUIRING', action: null });
  });

  test('emergency: tracking + upload lines; only the open emergency\'s fix is used', () => {
    const emergencyFix = fix(1_000, { latitude: 20 });
    const p = presentLiveLocation(
      input({
        tracking: LocationTrackingState.ACTIVE,
        openEmergencyId: 'evt-1',
        readiness: ready(fix(10_000)),
        emergencyLocation: {
          eventId: 'evt-1', status: EmergencyLocationStatus.AVAILABLE, reason: null, latestFix: emergencyFix,
          pointCount: 3, tracking: LocationTrackingState.ACTIVE, trackingFailureReason: null,
        },
        sync: { kind: 'NOT_CONNECTED', pending: 2 },
      })
    );
    expect(p.fix).toBe(emergencyFix);
    expect(p.trackingText).toBe('Emergency tracking on');
    expect(p.serverText).toBe('2 location points not uploaded yet');

    const other = presentLiveLocation(
      input({
        openEmergencyId: 'evt-2',
        emergencyLocation: {
          eventId: 'evt-1', status: EmergencyLocationStatus.AVAILABLE, reason: null, latestFix: emergencyFix,
          pointCount: 3, tracking: LocationTrackingState.IDLE, trackingFailureReason: null,
        },
      })
    );
    expect(other.fix).not.toBe(emergencyFix);
  });

  test('tracking refused by the system is shown honestly', () => {
    expect(
      presentLiveLocation(input({ tracking: LocationTrackingState.FAILED, openEmergencyId: 'e' })).trackingText
    ).toMatch(/paused/);
  });
});
