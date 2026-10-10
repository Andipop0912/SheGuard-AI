export enum EvidenceType {
  AUDIO = 'AUDIO',
}

export enum EvidenceSyncStatus {
  LOCAL_ONLY = 'LOCAL_ONLY',
  UPLOADED = 'UPLOADED',
  FAILED = 'FAILED',
}

/** Audio evidence recorded on-device for one emergency. Local-first: never blocks SOS. */
export interface EvidenceItem {
  evidenceId: string;
  eventId: string;
  type: EvidenceType;
  filePath: string;
  createdAt: number;
  durationMs: number;
  syncStatus: EvidenceSyncStatus;
}
