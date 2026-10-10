import { PermissionsAndroid, Platform } from 'react-native';

export type VoicePermissionResult = 'granted' | 'denied';

/**
 * Requests the runtime permissions the native VoiceDetectionService needs.
 *
 * Android 14+ throws a SecurityException when a microphone-type foreground service
 * starts without RECORD_AUDIO, so this must succeed before startVoiceDetection().
 * POST_NOTIFICATIONS (Android 13+) only affects the service notification; denial is tolerated.
 */
export async function ensureVoicePermissions(): Promise<VoicePermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  try {
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Microphone for voice SOS',
      message:
        'SheGuard listens on-device for "SheGuard Emergency" so you can call for help hands-free. Audio never leaves your phone.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });

    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    return mic === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
