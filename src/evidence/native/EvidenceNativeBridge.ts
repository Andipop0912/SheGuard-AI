import { NativeModules, Platform } from 'react-native';

const { SheGuardEvidenceModule } = NativeModules;

export interface NativeRecordingResult {
  filePath: string;
  durationMs: number;
}

export interface EvidenceNativeInterface {
  startRecording(eventId: string): Promise<string>;
  stopRecording(): Promise<NativeRecordingResult>;
  isRecording(): Promise<boolean>;
}

/**
 * Wraps the native MediaRecorder-backed evidence module. On platforms/environments without it
 * (iOS, Jest), recording is unsupported and callers get a clear rejection rather than a crash.
 */
export class EvidenceNativeModule implements EvidenceNativeInterface {
  private isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardEvidenceModule;
  }

  public async startRecording(eventId: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Evidence recording is not available on this device');
    }
    return SheGuardEvidenceModule.startRecording(eventId);
  }

  public async stopRecording(): Promise<NativeRecordingResult> {
    if (!this.isAvailable()) {
      throw new Error('Evidence recording is not available on this device');
    }
    return SheGuardEvidenceModule.stopRecording();
  }

  public async isRecording(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await SheGuardEvidenceModule.isRecording();
    } catch {
      return false;
    }
  }
}
