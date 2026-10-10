import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { EmergencyState } from '../../emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';

/** Wire format of backend/app/schemas/emergency.py (POST /api/v1/emergencies/sync). */
export interface EmergencyEventDto {
  eventId: string;
  userId: string;
  deviceId: string;
  triggerSource: EmergencyTriggerSource;
  state: EmergencyState;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface EmergencySyncRequestDto {
  events: EmergencyEventDto[];
}

export type EmergencySyncItemStatus = 'SYNCED' | 'ALREADY_SYNCED' | 'UPDATED' | 'FAILED';

export interface EmergencySyncResultDto {
  eventId: string;
  status: EmergencySyncItemStatus;
  serverReceivedAt: string;
  message?: string | null;
}

export interface EmergencySyncResponseDto {
  results: EmergencySyncResultDto[];
}

/**
 * The backend only accepts events whose userId/deviceId match the authenticated session. The
 * caller has already checked the event belongs to this account (or is unclaimed), so the
 * session's ids are sent. Local sync bookkeeping (syncStatus, syncedAt, syncError) is never sent.
 */
export function toEmergencyEventDto(
  event: EmergencyEvent,
  session: { userId: string; deviceId: string }
): EmergencyEventDto {
  return {
    eventId: event.eventId,
    userId: session.userId,
    deviceId: session.deviceId,
    triggerSource: event.triggerSource,
    state: event.state,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    resolvedAt: event.resolvedAt ?? null,
    metadata: {},
  };
}

const ITEM_STATUSES: readonly string[] = ['SYNCED', 'ALREADY_SYNCED', 'UPDATED', 'FAILED'];

export function parseEmergencySyncResponse(body: unknown): EmergencySyncResultDto[] | null {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  return results.filter(
    (r): r is EmergencySyncResultDto =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as EmergencySyncResultDto).eventId === 'string' &&
      ITEM_STATUSES.includes((r as EmergencySyncResultDto).status)
  );
}
