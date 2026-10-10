import { EmergencyEvent } from '../emergency/domain/EmergencyEvent';
import { SyncStatus } from '../emergency/domain/SyncStatus';
import { Session } from '../auth/domain/AuthState';
import { BadgeTone } from '../design/components/EmergencyComponents';
import { EmergencySyncSnapshot, belongsTo } from './EmergencySyncService';

export interface PresentedSync {
  status: string;
  badge: { text: string; tone: BadgeTone };
  /** True only when the server confirmed this exact version. */
  confirmed: boolean;
}

/**
 * Truthful server-backup state for one emergency. "Synced" appears only after the server
 * confirmed the current version (syncStatus SYNCED); everything else says where the data is.
 */
export function presentEventSync(
  event: EmergencyEvent,
  session: Session | null,
  sync: EmergencySyncSnapshot
): PresentedSync {
  switch (event.syncStatus) {
    case SyncStatus.SYNCED:
      return { status: 'Backed up to the SheGuard server', badge: { text: 'Synced', tone: 'active' }, confirmed: true };
    case SyncStatus.LOCAL_ONLY:
      return {
        status: 'Saved on this phone only · recorded before server backup existed',
        badge: { text: 'Local', tone: 'neutral' },
        confirmed: false,
      };
    case SyncStatus.FAILED:
      return {
        status: `Server did not accept it${event.syncError ? ` · ${event.syncError}` : ''}`,
        badge: { text: 'Not synced', tone: 'neutral' },
        confirmed: false,
      };
    case SyncStatus.PENDING:
    default:
      break;
  }

  if (!session) {
    return {
      status: 'Saved on this phone · sign in to back it up to the server',
      badge: { text: 'Local', tone: 'neutral' },
      confirmed: false,
    };
  }
  if (!belongsTo(event, session)) {
    return {
      status: 'Saved on this phone · belongs to another account',
      badge: { text: 'Local', tone: 'neutral' },
      confirmed: false,
    };
  }
  if (sync.syncingEventIds.includes(event.eventId)) {
    return { status: 'Uploading to the server…', badge: { text: 'Syncing', tone: 'pending' }, confirmed: false };
  }
  switch (sync.activity.kind) {
    case 'NOT_CONFIGURED':
      return {
        status: 'Saved on this phone · server not configured in this build',
        badge: { text: 'Local', tone: 'neutral' },
        confirmed: false,
      };
    case 'RETRY_SCHEDULED':
      return {
        status: `Saved on this phone · waiting to sync (${sync.activity.lastError})`,
        badge: { text: 'Pending', tone: 'pending' },
        confirmed: false,
      };
    default:
      return {
        status: 'Saved on this phone · waiting to sync',
        badge: { text: 'Pending', tone: 'pending' },
        confirmed: false,
      };
  }
}
