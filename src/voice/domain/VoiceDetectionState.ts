/**
 * Lifecycle states for Voice Keyword Detection.
 * Decoupled from ActivationState (ARM) and EmergencyState.
 */
export enum VoiceDetectionState {
  DISABLED = 'DISABLED',
  INITIALIZING = 'INITIALIZING',
  LISTENING = 'LISTENING',
  KEYWORD_DETECTED = 'KEYWORD_DETECTED',
  TRIGGER_REQUESTED = 'TRIGGER_REQUESTED',
  COOLDOWN = 'COOLDOWN',
  ERROR = 'ERROR',
}
