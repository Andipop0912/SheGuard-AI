import { PermissionsAndroid, Platform } from 'react-native';

export type EvidencePermissionResult = 'granted' | 'denied';

/** Same RECORD_AUDIO permission voice listening uses; requested again in case it was revoked. */
export async function ensureEvidencePermissions(): Promise<EvidencePermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  try {
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Microphone for evidence recording',
      message: 'Record audio evidence for this emergency. Saved on your phone only.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    return mic === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
