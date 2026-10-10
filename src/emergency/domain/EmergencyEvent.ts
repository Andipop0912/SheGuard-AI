import { EmergencyState } from './EmergencyState';
import { EmergencyTriggerSource } from './EmergencyTriggerSource';
import { SyncStatus } from './SyncStatus';

/**
 * Domain model representing a core emergency event.
 * Preserves Kotlin com.sheguardai.app.emergency.model.EmergencyEvent data class structure and default values.
 */
export interface EmergencyEvent {
  readonly eventId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly triggerSource: EmergencyTriggerSource;
  readonly state: EmergencyState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly resolvedAt?: number | null;
  readonly syncStatus: SyncStatus;
  /** When the server confirmed the current version (server time, epoch ms). Sync metadata only. */
  readonly syncedAt?: number | null;
  /** Short reason for FAILED / LOCAL_ONLY. Never contains tokens or personal data. */
  readonly syncError?: string | null;
}

export function createEmergencyEvent(
  params: {
    eventId: string;
    userId: string;
    deviceId: string;
    triggerSource: EmergencyTriggerSource;
    state?: EmergencyState;
    createdAt?: number;
    updatedAt?: number;
    resolvedAt?: number | null;
    syncStatus?: SyncStatus;
  }
): EmergencyEvent {
  const now = Date.now();
  return {
    eventId: params.eventId,
    userId: params.userId,
    deviceId: params.deviceId,
    triggerSource: params.triggerSource,
    state: params.state ?? EmergencyState.TRIGGERED,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
    resolvedAt: params.resolvedAt ?? null,
    syncStatus: params.syncStatus ?? SyncStatus.PENDING,
  };
}
