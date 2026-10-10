import { ActivationState } from '../../activation/domain/ActivationState';
import { VoiceDetectionState } from '../../voice/domain/VoiceDetectionState';
import {
  EmergencyLocationState,
  EmergencyLocationStatus,
  LocationAvailability,
  LocationReadiness,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../../location/domain/LocationState';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { fixAgeMs } from '../../location/domain/LocationFix';
import { StatusTone } from '../../design/components/StatusList';
import { BadgeTone } from '../../design/components/EmergencyComponents';

/**
 * Pure mappings from the authoritative core states to what the UI shows.
 * No state is created here; every value is derived from ActivationManager, the voice
 * service, the shake detector, LocationService or EmergencyCoordinator.
 */
export interface Presented {
  value: string;
  tone: StatusTone;
}

export function presentProtection(state: ActivationState): Presented {
  switch (state) {
    case ActivationState.ACTIVE:
      return { value: 'Active', tone: 'good' };
    case ActivationState.ACTIVATION_RECEIVED:
    case ActivationState.CHECKING_PERMISSIONS:
    case ActivationState.READY_TO_START:
    case ActivationState.STARTING:
      return { value: 'Starting…', tone: 'warn' };
    case ActivationState.STOPPING:
      return { value: 'Stopping…', tone: 'warn' };
    case ActivationState.ERROR:
      return { value: 'Error', tone: 'bad' };
    case ActivationState.INACTIVE:
    case ActivationState.PERMISSION_REQUIRED:
    default:
      return { value: 'Inactive', tone: 'off' };
  }
}

/** Shake follows Protection Mode: enabled only while the native detector is actually running. */
export function presentShake(isShakeListening: boolean): Presented {
  return isShakeListening ? { value: 'Enabled', tone: 'good' } : { value: 'Disabled', tone: 'off' };
}

/** Voice is ARM independent; shown exactly as the native voice service reports it. */
export function presentVoice(state: VoiceDetectionState): Presented {
  switch (state) {
    case VoiceDetectionState.LISTENING:
      return { value: 'Listening', tone: 'good' };
    case VoiceDetectionState.INITIALIZING:
      return { value: 'Starting…', tone: 'warn' };
    case VoiceDetectionState.KEYWORD_DETECTED:
    case VoiceDetectionState.TRIGGER_REQUESTED:
      return { value: 'Phrase detected', tone: 'bad' };
    case VoiceDetectionState.COOLDOWN:
      return { value: 'Cooldown', tone: 'warn' };
    case VoiceDetectionState.ERROR:
      return { value: 'Unavailable', tone: 'bad' };
    case VoiceDetectionState.DISABLED:
    default:
      return { value: 'Off', tone: 'off' };
  }
}

/** Home "Location" row: device readiness (not tied to an emergency). */
export function presentLocationReadiness(readiness: LocationReadiness): Presented {
  switch (readiness.availability) {
    case LocationAvailability.AVAILABLE:
      return { value: 'Ready', tone: 'good' };
    case LocationAvailability.STALE:
      return { value: 'Last known', tone: 'warn' };
    case LocationAvailability.ACQUIRING:
      return { value: 'Getting location…', tone: 'warn' };
    case LocationAvailability.PERMISSION_REQUIRED:
      return { value: 'Permission required', tone: 'warn' };
    case LocationAvailability.PERMISSION_DENIED:
      return { value: 'Permission denied', tone: 'bad' };
    case LocationAvailability.ERROR:
      return { value: 'Error', tone: 'bad' };
    case LocationAvailability.UNAVAILABLE:
    default:
      if (readiness.reason === LocationUnavailableReason.SERVICES_DISABLED) {
        return { value: 'Location off', tone: 'bad' };
      }
      if (readiness.reason === LocationUnavailableReason.NO_FIX) {
        return { value: 'Waiting for fix', tone: 'warn' };
      }
      return { value: 'Unavailable', tone: 'bad' };
  }
}

export interface PresentedCard {
  status: string;
  badge: { text: string; tone: BadgeTone };
}

const UNAVAILABLE_REASON: Record<LocationUnavailableReason, string> = {
  [LocationUnavailableReason.PERMISSION]: 'Location permission not granted',
  [LocationUnavailableReason.SERVICES_DISABLED]: 'Location services are off',
  [LocationUnavailableReason.NO_FIX]: 'No location fix yet',
  [LocationUnavailableReason.NOT_SUPPORTED]: 'Location not supported on this device',
  [LocationUnavailableReason.ERROR]: 'Location error',
};

function describeAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** Emergency screen "Location" card, from the emergency's own location state. */
export function presentEmergencyLocation(state: EmergencyLocationState | null, now: number): PresentedCard {
  if (!state) return { status: 'Getting location…', badge: { text: 'Pending', tone: 'pending' } };

  const age = state.latestFix ? ` · ${describeAge(fixAgeMs(state.latestFix, now))}` : '';
  const accuracy =
    state.latestFix?.accuracyMeters != null ? ` · ±${Math.round(state.latestFix.accuracyMeters)} m` : '';
  const trackingNote =
    state.tracking === LocationTrackingState.FAILED ? ' · live tracking paused (open the app)' : '';

  switch (state.status) {
    case EmergencyLocationStatus.AVAILABLE:
      return {
        status: `Location available${accuracy}${age}${trackingNote}`,
        badge: { text: state.tracking === LocationTrackingState.ACTIVE ? 'Live' : 'Active', tone: 'active' },
      };
    case EmergencyLocationStatus.STALE:
      return { status: `Last known location${age}${trackingNote}`, badge: { text: 'Stale', tone: 'pending' } };
    case EmergencyLocationStatus.PENDING:
      return { status: `Getting location…${trackingNote}`, badge: { text: 'Pending', tone: 'pending' } };
    case EmergencyLocationStatus.UNAVAILABLE:
    default:
      return {
        status: state.reason ? UNAVAILABLE_REASON[state.reason] : 'Location unavailable',
        badge: { text: 'Unavailable', tone: 'neutral' },
      };
  }
}

export function presentTriggerSource(source: EmergencyTriggerSource, voicePhrase: string | null): string {
  switch (source) {
    case EmergencyTriggerSource.MANUAL_SOS:
      return 'Manual SOS';
    case EmergencyTriggerSource.VOICE:
      return voicePhrase ? `Voice — "${voicePhrase}"` : 'Voice phrase';
    case EmergencyTriggerSource.GESTURE:
      return 'Shake detection';
    case EmergencyTriggerSource.HARDWARE_BUTTON:
      return 'Hardware button';
    case EmergencyTriggerSource.SYSTEM:
    default:
      return 'System';
  }
}
