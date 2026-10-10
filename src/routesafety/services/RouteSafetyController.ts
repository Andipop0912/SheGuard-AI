import { getEventOwner } from '../../app/identity';
import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { LocationService } from '../../location/services/LocationService';
import { LocationFix } from '../../location/domain/LocationFix';
import {
  advanceDeviationState,
  DeviationSnapshot,
  initialDeviationSnapshot,
} from '../domain/RouteDeviationDetector';
import {
  createRouteSafetySession,
  RouteDeviationState,
  RoutePoint,
  RouteSafetySession,
  RouteSafetyStatus,
} from '../domain/RouteSafetySession';
import { RouteSafetyRepository } from '../storage/RouteSafetyRepository';

export interface RouteSafetyApi {
  notifyStarted(session: RouteSafetySession): Promise<void>;
  notifyDeviation(session: RouteSafetySession): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  syncLocation(sessionId: string, point: RoutePoint, timestamp: number): Promise<void>;
}

export interface RouteRequest {
  startLocation: RoutePoint;
  destinationText: string;
  destinationLocation: RoutePoint | null;
  routePolyline: RoutePoint[];
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
}

/**
 * Owns the Route Safety session lifecycle. Reuses the existing location pipeline (LocationService)
 * instead of a second GPS watcher: it only starts/stops the SAME tracking toggle
 * EmergencyLocationController uses, and never stops it while an emergency is also open (that
 * controller's needs always win). Route deviation is evaluated locally on every fix; it is a
 * Route Safety event, never an emergency — EmergencyCoordinator is never touched by deviation.
 */
export class RouteSafetyController {
  private session: RouteSafetySession | null = null;
  private deviation: DeviationSnapshot = initialDeviationSnapshot(Date.now());
  private unsubscribeFixes: (() => void) | null = null;
  private unsubscribeEmergency: (() => void) | null = null;
  private emergencyOpen = false;
  private readonly listeners = new Set<(session: RouteSafetySession | null) => void>();

  constructor(
    private readonly coordinator: EmergencyCoordinator,
    private readonly location: LocationService,
    private readonly repository: RouteSafetyRepository,
    private readonly api: RouteSafetyApi
  ) {}

  /** Restores a session left ACTIVE from a previous run (e.g. app restart). Idempotent. */
  public async restore(): Promise<void> {
    if (this.session) return;
    const active = await this.repository.getActiveSession();
    if (!active) return;
    this.session = active;
    this.deviation = {
      state: active.deviationState,
      since: active.deviationStateSince ?? active.startedAt,
      alertSentAt: active.deviationAlertSentAt,
    };
    this.attach();
    this.publish();
  }

  public getSession(): RouteSafetySession | null {
    return this.session;
  }

  public subscribe(listener: (session: RouteSafetySession | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.session);
    return () => this.listeners.delete(listener);
  }

  public async start(request: RouteRequest): Promise<RouteSafetySession> {
    // Ending a different route silently replacing the baseline is not allowed; the caller must
    // explicitly end the current one first (see Part 4: never silently replace the original route).
    if (this.session && this.session.status === RouteSafetyStatus.ACTIVE) {
      throw new Error('A Route Safety session is already active. End it before starting a new one.');
    }

    const now = Date.now();
    const owner = getEventOwner();
    const session = createRouteSafetySession({
      sessionId: `rs-${now}-${Math.random().toString(36).slice(2, 8)}`,
      userId: owner.userId,
      deviceId: owner.deviceId,
      startLocation: request.startLocation,
      destinationText: request.destinationText,
      destinationLocation: request.destinationLocation,
      routePolyline: request.routePolyline,
      routeDistanceMeters: request.routeDistanceMeters,
      routeDurationSeconds: request.routeDurationSeconds,
      startedAt: now,
    });

    this.session = session;
    this.deviation = initialDeviationSnapshot(now);
    await this.repository.save(session);
    this.attach();
    this.publish();

    // Immediate notification — never waits for an emergency, derouting, or arrival (Part 9).
    this.safely(async () => {
      await this.api.notifyStarted(session);
      if (this.session?.sessionId === session.sessionId) {
        this.session = { ...this.session, startNotificationSent: true };
        await this.repository.save(this.session);
        this.publish();
      }
    });

    return session;
  }

  public async end(status: RouteSafetyStatus.ENDED | RouteSafetyStatus.CANCELLED = RouteSafetyStatus.ENDED): Promise<void> {
    if (!this.session || this.session.status !== RouteSafetyStatus.ACTIVE) return;
    const ended = { ...this.session, status, endedAt: Date.now() };
    this.session = ended;
    await this.repository.save(ended);
    this.detach();
    this.publish();

    this.safely(() => this.api.endSession(ended.sessionId));

    // Never stop tracking an emergency still relies on.
    if (!this.emergencyOpen) {
      await this.location.stopTracking();
    }
  }

  private attach(): void {
    if (this.unsubscribeFixes) return;
    this.location.startTracking().catch(() => undefined);
    this.unsubscribeFixes = this.location.subscribeFixes((fix) => {
      this.safely(() => this.onFix(fix));
    });
    this.unsubscribeEmergency = this.coordinator.subscribeActiveEvent((event) => {
      this.emergencyOpen = !!event && isOpenEmergencyState(event.state);
    });
  }

  private detach(): void {
    this.unsubscribeFixes?.();
    this.unsubscribeFixes = null;
    this.unsubscribeEmergency?.();
    this.unsubscribeEmergency = null;
  }

  private async onFix(fix: LocationFix): Promise<void> {
    if (!this.session || this.session.status !== RouteSafetyStatus.ACTIVE) return;
    const point: RoutePoint = { latitude: fix.latitude, longitude: fix.longitude };

    const { snapshot, shouldAlertNow } = advanceDeviationState(
      this.deviation,
      { point, accuracyMeters: fix.accuracyMeters, timestamp: fix.timestamp },
      this.session.routePolyline
    );
    this.deviation = snapshot;

    this.session = {
      ...this.session,
      currentLocation: point,
      lastLocationAt: fix.timestamp,
      deviationState: snapshot.state,
      deviationStateSince: snapshot.since,
      deviationAlertSentAt: snapshot.alertSentAt,
    };
    await this.repository.save(this.session);
    this.publish();

    this.safely(() => this.api.syncLocation(this.session!.sessionId, point, fix.timestamp));
    if (shouldAlertNow) {
      this.safely(() => this.api.notifyDeviation(this.session!));
    }
  }

  private publish(): void {
    this.listeners.forEach((listener) => listener(this.session));
  }

  private safely(work: () => Promise<void> | void): void {
    Promise.resolve()
      .then(work)
      .catch((e) => {
        // Route Safety's own network/backend problems must never affect local tracking or the emergency path.
        console.warn('[RouteSafetyController] background work failed', e);
      });
  }
}

export { RouteDeviationState };
