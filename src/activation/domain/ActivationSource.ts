/**
 * Sources capable of triggering emergency activation.
 * Preserves exact enum names from Kotlin com.sheguardai.app.activation.ActivationSource.
 */
export enum ActivationSource {
  MOCK = 'MOCK',
  HARDWARE_BUTTON = 'HARDWARE_BUTTON',
  PHONE_GESTURE = 'PHONE_GESTURE',
  NOTIFICATION_ACTION = 'NOTIFICATION_ACTION',
  WIDGET = 'WIDGET',
  /** The Protection Mode toggle in the app UI. */
  IN_APP = 'IN_APP',
  UNKNOWN = 'UNKNOWN',
}
