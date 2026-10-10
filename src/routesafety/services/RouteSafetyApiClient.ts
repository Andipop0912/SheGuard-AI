import { ApiClient } from '../../api/ApiClient';
import { RouteSafetyApi } from './RouteSafetyController';
import { RoutePoint, RouteSafetySession } from '../domain/RouteSafetySession';

/**
 * Backend-facing half of Route Safety, through the same authenticated ApiClient every other
 * server feature uses. Every call here is best-effort from the controller's point of view: a
 * failure here never touches local tracking, the deviation state machine, or the emergency path.
 */
export class RouteSafetyApiClient implements RouteSafetyApi {
  constructor(private readonly api: ApiClient) {}

  public async createSession(session: RouteSafetySession): Promise<void> {
    await this.api.authorizedRequest({
      method: 'POST',
      path: '/route-safety',
      body: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        startLocation: session.startLocation,
        destinationText: session.destinationText,
        destinationLocation: session.destinationLocation,
        routePolyline: session.routePolyline,
        routeDistanceMeters: session.routeDistanceMeters,
        routeDurationSeconds: session.routeDurationSeconds,
        startedAt: session.startedAt,
      },
    });
  }

  /** The POST /route-safety call itself triggers the server's immediate start notification. */
  public async notifyStarted(session: RouteSafetySession): Promise<void> {
    await this.createSession(session);
  }

  public async notifyDeviation(session: RouteSafetySession): Promise<void> {
    await this.api.authorizedRequest({ method: 'POST', path: `/route-safety/${encodeURIComponent(session.sessionId)}/deviation` });
  }

  public async endSession(sessionId: string): Promise<void> {
    await this.api.authorizedRequest({ method: 'POST', path: `/route-safety/${encodeURIComponent(sessionId)}/end` });
  }

  public async syncLocation(sessionId: string, point: RoutePoint, timestamp: number): Promise<void> {
    await this.api.authorizedRequest({
      method: 'POST',
      path: `/route-safety/${encodeURIComponent(sessionId)}/location`,
      body: { latitude: point.latitude, longitude: point.longitude, timestamp },
    });
  }
}
