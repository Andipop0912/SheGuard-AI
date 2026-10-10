import { NativeModules, Platform } from 'react-native';

const { SheGuardEvidenceDownloadModule } = NativeModules;

export interface EvidenceDownloadNative {
  /** Copies an on-device file into the public Downloads collection. */
  saveLocalFile(sourcePath: string, fileName: string, mimeType: string): Promise<void>;
  /** Fetches a remote URL (e.g. a Supabase signed URL) and saves it into public Downloads. */
  downloadUrl(url: string, fileName: string, mimeType: string): Promise<void>;
}

/**
 * Wraps the native MediaStore-backed download module. On platforms/environments without it
 * (iOS, Jest), downloading is unsupported and callers get a clear rejection.
 */
export class EvidenceDownloadModule implements EvidenceDownloadNative {
  private isAvailable(): boolean {
    return Platform.OS === 'android' && !!SheGuardEvidenceDownloadModule;
  }

  public async saveLocalFile(sourcePath: string, fileName: string, mimeType: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Downloading is not available on this device');
    }
    await SheGuardEvidenceDownloadModule.saveLocalFileToDownloads(sourcePath, fileName, mimeType);
  }

  public async downloadUrl(url: string, fileName: string, mimeType: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Downloading is not available on this device');
    }
    await SheGuardEvidenceDownloadModule.downloadUrlToDownloads(url, fileName, mimeType);
  }
}
