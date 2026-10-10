/**
 * Represents the current lifecycle state during an emergency event.
 * Preserves Kotlin com.sheguardai.app.emergency.model.EmergencyState.
 */
export enum EmergencyState {
  IDLE = 'IDLE',
  TRIGGERED = 'TRIGGERED',
  RESPONDING = 'RESPONDING',
  NOTIFYING = 'NOTIFYING',
  MONITORING = 'MONITORING',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}

/**
 * True while an emergency is still in progress (not yet RESOLVED or CANCELLED).
 */
export function isOpenEmergencyState(state: EmergencyState): boolean {
  return (
    state === EmergencyState.TRIGGERED ||
    state === EmergencyState.RESPONDING ||
    state === EmergencyState.NOTIFYING ||
    state === EmergencyState.MONITORING
  );
}
