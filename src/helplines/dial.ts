import { Linking } from 'react-native';
import { Helpline, findDialableHelpline } from './domain/Helpline';

export type DialResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'DIALER_UNAVAILABLE' };

/**
 * Opens the system dialer pre-filled with a helpline's number (`tel:` → Android ACTION_DIAL).
 * This hands off to the phone's own call interface and requires no CALL_PHONE permission,
 * no backend, and no login — the call itself is never placed by SheGuard.
 *
 * The number can only come from the bundled, verified dataset: `helplineId` is resolved through
 * `findDialableHelpline`, so there is no code path here that dials anything else.
 */
export async function dialHelpline(helplineId: string): Promise<DialResult> {
  const helpline: Helpline | null = findDialableHelpline(helplineId);
  if (!helpline) return { ok: false, reason: 'NOT_FOUND' };

  const url = `tel:${helpline.number}`;
  try {
    const supported = await Promise.resolve(Linking.canOpenURL(url));
    if (supported === false) return { ok: false, reason: 'DIALER_UNAVAILABLE' };
    await Promise.resolve(Linking.openURL(url));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'DIALER_UNAVAILABLE' };
  }
}
