import { NativeModules, Platform } from 'react-native';

const { SheGuardAskVoiceModule } = NativeModules;

export interface AskVoiceInputNative {
  /** Resolves with the recognized utterance, or rejects (no speech, error, unavailable). */
  recognize(): Promise<string>;
  cancel(): void;
}

/**
 * Wraps the native one-shot speech-to-text module for the Ask SheGuard chat input. On
 * platforms/environments without it (iOS, Jest), voice input is unsupported and callers get a
 * clear rejection rather than a crash — text input always remains available either way.
 */
export class AskVoiceInputModule implements AskVoiceInputNative {
  private isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardAskVoiceModule;
  }

  public async recognize(): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Voice input is not available on this device');
    }
    return SheGuardAskVoiceModule.recognize();
  }

  public cancel(): void {
    if (this.isAvailable()) SheGuardAskVoiceModule.cancel();
  }
}
