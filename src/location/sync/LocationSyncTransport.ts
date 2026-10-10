import { EmergencyLocationPoint } from '../storage/EmergencyLocationRepository';

export type PointSyncOutcome = 'SYNCED' | 'ALREADY_SYNCED' | 'FAILED';

export type LocationSyncResult =
  /** No authenticated connection to the backend exists (yet). Points stay pending; nothing is retried on a timer. */
  | { kind: 'NOT_CONNECTED' }
  /** Backend has not received the emergency itself yet; retry later. */
  | { kind: 'EVENT_NOT_SYNCED' }
  /** Network/server problem; retry with backoff. */
  | { kind: 'RETRYABLE_ERROR'; message: string }
  | { kind: 'RESULTS'; results: { locationId: string; status: PointSyncOutcome; message: string | null }[] };

/**
 * Sends one emergency's location points to the backend
 * (POST /api/v1/emergencies/{eventId}/locations/sync).
 */
export interface LocationSyncTransport {
  send(eventId: string, points: EmergencyLocationPoint[]): Promise<LocationSyncResult>;
}

/**
 * Default transport until the app has an authenticated API client.
 * It reports the truth — not connected — and never pretends a point reached the server.
 */
export class DisconnectedLocationSyncTransport implements LocationSyncTransport {
  public async send(): Promise<LocationSyncResult> {
    return { kind: 'NOT_CONNECTED' };
  }
}

export interface AccessTokenProvider {
  /** Current device-bound access token, or null when signed out. */
  getAccessToken(): Promise<string | null>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Backend transport for when authentication exists. Not wired in by default. */
export class HttpLocationSyncTransport implements LocationSyncTransport {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly tokens: AccessTokenProvider,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  public async send(eventId: string, points: EmergencyLocationPoint[]): Promise<LocationSyncResult> {
    const token = await this.tokens.getAccessToken();
    if (!token) return { kind: 'NOT_CONNECTED' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.apiBaseUrl}/emergencies/${encodeURIComponent(eventId)}/locations/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            points: points.map((p) => ({
              locationId: p.locationId,
              kind: p.kind,
              latitude: p.fix.latitude,
              longitude: p.fix.longitude,
              accuracyMeters: p.fix.accuracyMeters,
              altitudeMeters: p.fix.altitudeMeters,
              speedMps: p.fix.speedMps,
              headingDegrees: p.fix.headingDegrees,
              provider: p.fix.provider,
              isLastKnown: p.fix.isLastKnown,
              capturedAt: p.fix.timestamp,
            })),
          }),
          signal: controller.signal,
        }
      );

      if (response.status === 404) return { kind: 'EVENT_NOT_SYNCED' };
      if (response.status === 401 || response.status === 403) return { kind: 'NOT_CONNECTED' };
      if (!response.ok) return { kind: 'RETRYABLE_ERROR', message: `HTTP ${response.status}` };

      const body = (await response.json()) as {
        results?: { locationId: string; status: PointSyncOutcome; message?: string | null }[];
      };
      return {
        kind: 'RESULTS',
        results: (body.results ?? []).map((r) => ({
          locationId: r.locationId,
          status: r.status,
          message: r.message ?? null,
        })),
      };
    } catch (e) {
      return { kind: 'RETRYABLE_ERROR', message: e instanceof Error ? e.message : 'Network error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
