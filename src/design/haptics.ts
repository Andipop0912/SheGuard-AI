import { Vibration } from 'react-native';

/** Two short pulses so the user feels the SOS registered, without drawing attention. */
export function sosConfirmationVibration(): void {
  try {
    Vibration.vibrate([0, 60, 200, 60]);
  } catch {
    // Vibration is feedback only; never let it affect SOS.
  }
}
