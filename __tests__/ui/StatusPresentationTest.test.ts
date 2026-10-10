import {
  presentEmergencyLocation,
  presentLocationReadiness,
  presentProtection,
  presentShake,
  presentTriggerSource,
  presentVoice,
} from '../../src/features/home/statusPresentation';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { VoiceDetectionState } from '../../src/voice/domain/VoiceDetectionState';
import {
  EmergencyLocationStatus,
  INITIAL_LOCATION_READINESS,
  LocationAvailability,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../../src/location/domain/LocationState';
import { LocationProvider } from '../../src/location/domain/LocationFix';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';

const NOW = 1_800_000_000_000;
const fix = (ageMs: number) => ({
  latitude: 18.5,
  longitude: 73.8,
  accuracyMeters: 12.4,
  altitudeMeters: null,
  speedMps: null,
  headingDegrees: null,
  timestamp: NOW - ageMs,
  provider: LocationProvider.FUSED,
  isLastKnown: false,
});

describe('status presentation (derived only from the core states)', () => {
  test('Protection Mode ACTIVE / INACTIVE / transitional', () => {
    expect(presentProtection(ActivationState.ACTIVE)).toEqual({ value: 'Active', tone: 'good' });
    expect(presentProtection(ActivationState.INACTIVE)).toEqual({ value: 'Inactive', tone: 'off' });
    expect(presentProtection(ActivationState.STARTING).value).toBe('Starting…');
    expect(presentProtection(ActivationState.STOPPING).value).toBe('Stopping…');
    expect(presentProtection(ActivationState.ERROR).tone).toBe('bad');
  });

  test('Shake ENABLED only while the detector is running', () => {
    expect(presentShake(true)).toEqual({ value: 'Enabled', tone: 'good' });
    expect(presentShake(false)).toEqual({ value: 'Disabled', tone: 'off' });
  });

  test('Voice follows the native voice service state', () => {
    expect(presentVoice(VoiceDetectionState.LISTENING)).toEqual({ value: 'Listening', tone: 'good' });
    expect(presentVoice(VoiceDetectionState.DISABLED).value).toBe('Off');
    expect(presentVoice(VoiceDetectionState.ERROR).value).toBe('Unavailable');
    expect(presentVoice(VoiceDetectionState.COOLDOWN).value).toBe('Cooldown');
    expect(presentVoice(VoiceDetectionState.INITIALIZING).value).toBe('Starting…');
  });

  test('Location readiness is shown truthfully', () => {
    expect(presentLocationReadiness(INITIAL_LOCATION_READINESS).value).toBe('Unavailable');
    expect(
      presentLocationReadiness({ ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.AVAILABLE }).value
    ).toBe('Ready');
    expect(
      presentLocationReadiness({ ...INITIAL_LOCATION_READINESS, availability: LocationAvailability.PERMISSION_DENIED })
        .value
    ).toBe('Permission denied');
    expect(
      presentLocationReadiness({
        ...INITIAL_LOCATION_READINESS,
        reason: LocationUnavailableReason.SERVICES_DISABLED,
      }).value
    ).toBe('Location off');
  });

  test('Emergency location card: pending, available (live), stale, unavailable', () => {
    expect(presentEmergencyLocation(null, NOW).badge.text).toBe('Pending');

    const base = {
      eventId: 'e1',
      reason: null,
      pointCount: 1,
      trackingFailureReason: null,
    };
    const live = presentEmergencyLocation(
      { ...base, status: EmergencyLocationStatus.AVAILABLE, latestFix: fix(5_000), tracking: LocationTrackingState.ACTIVE },
      NOW
    );
    expect(live.badge).toEqual({ text: 'Live', tone: 'active' });
    expect(live.status).toContain('±12 m');
    expect(live.status).toContain('5s ago');

    const stale = presentEmergencyLocation(
      { ...base, status: EmergencyLocationStatus.STALE, latestFix: fix(5 * 60_000), tracking: LocationTrackingState.FAILED },
      NOW
    );
    expect(stale.badge.text).toBe('Stale');
    expect(stale.status).toContain('5 min ago');
    expect(stale.status).toContain('live tracking paused');

    const none = presentEmergencyLocation(
      {
        ...base,
        status: EmergencyLocationStatus.UNAVAILABLE,
        reason: LocationUnavailableReason.PERMISSION,
        latestFix: null,
        tracking: LocationTrackingState.IDLE,
      },
      NOW
    );
    expect(none).toEqual({ status: 'Location permission not granted', badge: { text: 'Unavailable', tone: 'neutral' } });
  });

  test('Trigger source, including the matched voice phrase', () => {
    expect(presentTriggerSource(EmergencyTriggerSource.MANUAL_SOS, null)).toBe('Manual SOS');
    expect(presentTriggerSource(EmergencyTriggerSource.GESTURE, null)).toBe('Shake detection');
    expect(presentTriggerSource(EmergencyTriggerSource.VOICE, 'sheguard help me')).toBe('Voice — "sheguard help me"');
    expect(presentTriggerSource(EmergencyTriggerSource.VOICE, null)).toBe('Voice phrase');
  });
});
