/**
 * Protection lifecycle states for SheGuard AI safety activation.
 * Preserves exact enum names from Kotlin com.sheguardai.app.activation.ActivationState.
 */
export enum ActivationState {
  INACTIVE = 'INACTIVE',
  ACTIVATION_RECEIVED = 'ACTIVATION_RECEIVED',
  CHECKING_PERMISSIONS = 'CHECKING_PERMISSIONS',
  PERMISSION_REQUIRED = 'PERMISSION_REQUIRED',
  READY_TO_START = 'READY_TO_START',
  STARTING = 'STARTING',
  ACTIVE = 'ACTIVE',
  STOPPING = 'STOPPING',
  ERROR = 'ERROR',
}
