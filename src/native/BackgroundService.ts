import { NativeModules, Platform } from 'react-native';

const { SheGuardBackgroundService } = NativeModules;

export interface BackgroundServiceNativeInterface {
  startForegroundService(title: string, message: string): Promise<boolean>;
  stopForegroundService(): Promise<boolean>;
}

export class BackgroundServiceNativeModule implements BackgroundServiceNativeInterface {
  public async startForegroundService(title: string, message: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardBackgroundService) {
      return false;
    }
    try {
      return await SheGuardBackgroundService.startService(title, message);
    } catch {
      return false;
    }
  }

  public async stopForegroundService(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardBackgroundService) {
      return false;
    }
    try {
      return await SheGuardBackgroundService.stopService();
    } catch {
      return false;
    }
  }
}
