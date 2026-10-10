/**
 * Source mechanism that triggered the emergency event.
 * Preserves Kotlin com.sheguardai.app.emergency.model.EmergencyTriggerSource.
 */
export enum EmergencyTriggerSource {
  MANUAL_SOS = 'MANUAL_SOS',
  VOICE = 'VOICE',
  GESTURE = 'GESTURE',
  HARDWARE_BUTTON = 'HARDWARE_BUTTON',
  SYSTEM = 'SYSTEM',
}
