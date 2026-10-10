import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

export interface HardwareButtonNativeInterface {
  isHardwareButtonMonitoringSupported(): Promise<boolean>;
  startHardwareButtonListener(): Promise<boolean>;
  stopHardwareButtonListener(): Promise<boolean>;
}

const { SheGuardHardwareButton } = NativeModules;

export class HardwareButtonNativeModule implements HardwareButtonNativeInterface {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (SheGuardHardwareButton && Platform.OS === 'android') {
      this.eventEmitter = new NativeEventEmitter(SheGuardHardwareButton);
    }
  }

  public async isHardwareButtonMonitoringSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardHardwareButton) {
      return false;
    }
    try {
      return await SheGuardHardwareButton.isSupported();
    } catch {
      return false;
    }
  }

  public async startHardwareButtonListener(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardHardwareButton) {
      return false;
    }
    try {
      return await SheGuardHardwareButton.startListener();
    } catch {
      return false;
    }
  }

  public async stopHardwareButtonListener(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SheGuardHardwareButton) {
      return false;
    }
    try {
      return await SheGuardHardwareButton.stopListener();
    } catch {
      return false;
    }
  }

  public onHardwareButtonPressed(callback: () => void): () => void {
    if (!this.eventEmitter) return () => {};
    const subscription = this.eventEmitter.addListener('onHardwareButtonTriggered', callback);
    return () => subscription.remove();
  }
}
