import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { LocationFix } from '../domain/LocationFix';
import {
  EmergencyLocationState,
  EmergencyLocationStatus,
  LocationPermissionStatus,
  LocationReadiness,
  LocationTrackingState,
  LocationUnavailableReason,
} from '../domain/LocationState';
import { EmergencyLocationRepository, LocationPointKind } from '../storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../sync/LocationSyncQueue';
import { LocationService } from './LocationService';

/**
 * Ties location capture to the existing emergency lifecycle — without changing it.
 *
 * Observes EmergencyCoordinator. When an emergency opens it records a snapshot from the
 * best fix available right now (no GPS wait) and starts tracking; when it closes, tracking
 * stops. It never creates, delays, cancels or otherwise drives an emergency.
 */
export class EmergencyLocationController {
  private unsubscribeCoordinator: (() => void) | null = null;
  private unsubscribeFixes: (() => void) | null = null;
  private unsubscribeTracking: (() => void) | null = null;
  private unsubscribeReadiness: (() => void) | null = null;
  /** In-flight recovery after permission becomes available (prevents doing it twice). */
  private permissionRecovery: Promise<void> | null = null;
  /** Emergency whose beginEmergency() is still running (recovery must not interleave with it). */
  private beginningEventId: string | null = null;
  private activeEventId: string | null = null;
  private state: EmergencyLocationState | null = null;
  private readonly listeners = new Set<(state: EmergencyLocationState | null) => void>();

  constructor(
    private readonly coordinator: EmergencyCoordinator,
    private readonly location: LocationService,
    private readonly repository: EmergencyLocationRepository,
    private readonly syncQueue: LocationSyncQueue
  ) {}

  /** Idempotent. */
  public start(): void {
    if (this.unsubscribeCoordinator) return;

    this.unsubscribeFixes = this.location.subscribeFixes((fix) => {
      this.safely(() => this.onFix(fix));
    });
    this.unsubscribeTracking = this.location.subscribeTracking((tracking, reason) => {
      if (this.state) this.publish({ ...this.state, tracking, trackingFailureReason: reason });
    });
    // Permission can be granted after an emergency opened (in-app prompt or Android Settings).
    this.unsubscribeReadiness = this.location.subscribeReadiness((readiness) => {
      this.safely(() => this.onReadinessChanged(readiness));
    });
    // Synchronous callback from the coordinator: only schedule work, never block it.
    this.unsubscribeCoordinator = this.coordinator.subscribeActiveEvent((event) => {
      this.safely(() => this.onEmergencyChanged(event));
    });
  }

  public stop(): void {
    this.unsubscribeCoordinator?.();
    this.unsubscribeFixes?.();
    this.unsubscribeTracking?.();
    this.unsubscribeReadiness?.();
    this.unsubscribeCoordinator = this.unsubscribeFixes = this.unsubscribeTracking = this.unsubscribeReadiness = null;
  }

  public getState(): EmergencyLocationState | null {
    return this.state;
  }

  public subscribe(listener: (state: EmergencyLocationState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private async onEmergencyChanged(event: EmergencyEvent | null): Promise<void> {
    console.info(
      `[EmergencyLocationController] onEmergencyChanged eventId=${event?.eventId ?? 'null'} state=${event?.state ?? 'null'} activeEventId=${this.activeEventId}`
    );
    if (event && isOpenEmergencyState(event.state)) {
      if (this.activeEventId === event.eventId) {
        console.info('[EmergencyLocationController] repeated notification for the same emergency — skipped');
        return; // repeated notification for the same emergency
      }
      this.activeEventId = event.eventId;
      this.beginningEventId = event.eventId;
      try {
        await this.beginEmergency(event.eventId);
      } catch (e) {
        console.warn('[EmergencyLocationController] beginEmergency threw', e);
        throw e;
      } finally {
        if (this.beginningEventId === event.eventId) this.beginningEventId = null;
      }
      return;
    }

    if (this.activeEventId && (!event || event.eventId === this.activeEventId)) {
      const endedEventId = this.activeEventId;
      this.activeEventId = null;
      await this.location.stopTracking();
      if (this.state?.eventId === endedEventId) {
        this.publish({ ...this.state, tracking: LocationTrackingState.IDLE, trackingFailureReason: null });
      }
      await this.syncQueue.flush();
    }
  }

  private async beginEmergency(eventId: string): Promise<void> {
    console.info(`[EmergencyLocationController] beginEmergency start eventId=${eventId}`);
    const existingPoints = await this.repository.getPoints(eventId);
    const existingSummary = await this.repository.getSummary(eventId);
    console.info(
      `[EmergencyLocationController] beginEmergency repository read eventId=${eventId} existingPoints=${existingPoints.length} trackingState=${this.location.getTrackingState()}`
    );

    this.publish({
      eventId,
      status: existingSummary?.status ?? EmergencyLocationStatus.PENDING,
      reason: existingSummary?.reason ?? null,
      latestFix: existingPoints.length > 0 ? existingPoints[existingPoints.length - 1].fix : null,
      pointCount: existingPoints.length,
      tracking: this.location.getTrackingState(),
      trackingFailureReason: this.location.getTrackingFailureReason(),
    });

    // A restored emergency (app restart) already has its snapshot; only tracking resumes.
    if (existingPoints.length === 0) {
      await this.recordSnapshot(eventId);
    }

    if (this.activeEventId !== eventId) {
      console.info(`[EmergencyLocationController] beginEmergency aborted (closed during snapshot) eventId=${eventId}`);
      return; // closed while the snapshot was being taken
    }
    // Fresh permission state: the restore path above skips the snapshot (which also refreshes it).
    const readiness = await this.location.refreshReadiness();
    console.info(`[EmergencyLocationController] beginEmergency readiness eventId=${eventId} permission=${readiness.permission}`);
    if (readiness.permission !== LocationPermissionStatus.GRANTED) return;

    await this.location.startTracking();
    console.info(
      `[EmergencyLocationController] beginEmergency after startTracking eventId=${eventId} trackingState=${this.location.getTrackingState()}`
    );
    if (this.location.getTrackingState() === LocationTrackingState.FAILED && this.activeEventId === eventId) {
      // Tracking could not start (e.g. app in background). Try one direct fix as a fallback;
      // a fix it obtains reaches onFix() through the fix subscription and is recorded there.
      await this.location.acquireCurrentFix();
    }
  }

  /**
   * Resumes location for an open emergency once permission is GRANTED, if tracking is not
   * running: IDLE (never started, e.g. permission was missing) or FAILED (e.g. Android refused
   * to start it while the app was in the background). Readiness refreshes happen on app
   * foreground and user actions — never on a timer. startTracking() is idempotent.
   */
  private async onReadinessChanged(readiness: LocationReadiness): Promise<void> {
    const eventId = this.activeEventId;
    if (!eventId || readiness.permission !== LocationPermissionStatus.GRANTED) return;
    const tracking = this.location.getTrackingState();
    if (tracking !== LocationTrackingState.IDLE && tracking !== LocationTrackingState.FAILED) return;
    // Still being handled by beginEmergency().
    if (this.beginningEventId === eventId || this.state?.eventId !== eventId) return;
    if (this.permissionRecovery) return;

    this.permissionRecovery = (async () => {
      if (this.state?.status === EmergencyLocationStatus.UNAVAILABLE && this.state.pointCount === 0) {
        await this.recordSnapshot(eventId);
      }
      if (this.activeEventId === eventId) {
        await this.location.startTracking();
      }
    })().finally(() => {
      this.permissionRecovery = null;
    });
    await this.permissionRecovery;
  }

  private async recordSnapshot(eventId: string): Promise<void> {
    console.info(`[EmergencyLocationController] recordSnapshot start eventId=${eventId}`);
    const best = await this.location.getBestAvailableFixNow();
    console.info(`[EmergencyLocationController] recordSnapshot result eventId=${eventId} kind=${best.kind}`);

    if (best.kind === 'NONE') {
      // Permission denied or location services off: unavailable. Otherwise a fix may still arrive.
      const status =
        best.reason === LocationUnavailableReason.NO_FIX
          ? EmergencyLocationStatus.PENDING
          : EmergencyLocationStatus.UNAVAILABLE;
      await this.updateSummary(eventId, status, best.reason);
      return;
    }

    await this.repository.addPoint(eventId, LocationPointKind.SNAPSHOT, best.fix);
    await this.updateSummary(
      eventId,
      best.kind === 'FRESH' ? EmergencyLocationStatus.AVAILABLE : EmergencyLocationStatus.STALE,
      null
    );
    await this.syncQueue.flush();
  }

  private async onFix(fix: LocationFix): Promise<void> {
    const eventId = this.activeEventId;
    if (!eventId) return; // fixes outside an emergency are not recorded against any event
    await this.recordPoint(eventId, LocationPointKind.UPDATE, fix);
  }

  private async recordPoint(eventId: string, kind: LocationPointKind, fix: LocationFix): Promise<void> {
    const stored = await this.repository.addPoint(eventId, kind, fix);
    if (!stored) return; // local cap reached
    await this.updateSummary(
      eventId,
      this.location.isFresh(fix) ? EmergencyLocationStatus.AVAILABLE : EmergencyLocationStatus.STALE,
      null
    );
    await this.syncQueue.flush();
  }

  private async updateSummary(
    eventId: string,
    status: EmergencyLocationStatus,
    reason: LocationUnavailableReason | null
  ): Promise<void> {
    await this.repository.setSummary(eventId, status, reason);
    if (this.state?.eventId !== eventId) return;
    const points = await this.repository.getPoints(eventId);
    this.publish({
      ...this.state,
      status,
      reason,
      latestFix: points.length > 0 ? points[points.length - 1].fix : null,
      pointCount: points.length,
    });
  }

  private publish(state: EmergencyLocationState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  private safely(work: () => Promise<void>): void {
    work().catch((e) => {
      // Location problems must never surface into emergency handling.
      console.warn('[EmergencyLocationController] location work failed', e);
    });
  }
}
