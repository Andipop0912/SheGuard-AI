/**
 * Backend synchronization status for local emergency events.
 * Preserves Kotlin com.sheguardai.app.emergency.model.SyncStatus.
 */
export enum SyncStatus {
  /** Needs uploading (new event, or a lifecycle change since the last confirmed upload). */
  PENDING = 'PENDING',
  /** The server confirmed this exact version of the event (same updatedAt). */
  SYNCED = 'SYNCED',
  /** The server rejected the event; not retried automatically. See syncError. */
  FAILED = 'FAILED',
  /** Never uploaded by design (events recorded before server backup existed). */
  LOCAL_ONLY = 'LOCAL_ONLY',
}
