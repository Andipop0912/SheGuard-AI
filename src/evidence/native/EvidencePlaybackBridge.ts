import { NativeModules, Platform } from 'react-native';

const { SheGuardEvidencePlaybackModule } = NativeModules;

export interface EvidencePlaybackResult {
  /** false when stopped early by the user rather than finishing naturally. */
  completed: boolean;
}

export interface EvidencePlaybackNative {
  /** Resolves when playback finishes or is stopped; rejects on a real playback error. */
  play(filePath: string): Promise<EvidencePlaybackResult>;
  stop(): Promise<void>;
}

/**
 * Wraps the native MediaPlayer-backed evidence playback module. On platforms/environments
 * without it (iOS, Jest), playback is unsupported and callers get a clear rejection.
 */
export class EvidencePlaybackModule implements EvidencePlaybackNative {
  private isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardEvidencePlaybackModule;
  }

  public async play(filePath: string): Promise<EvidencePlaybackResult> {
    if (!this.isAvailable()) {
      throw new Error('Audio playback is not available on this device');
    }
    return SheGuardEvidencePlaybackModule.play(filePath);
  }

  public async stop(): Promise<void> {
    if (this.isAvailable()) await SheGuardEvidencePlaybackModule.stop();
  }
}
