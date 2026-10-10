import { ApiResult, HttpClient, HttpRequest } from './HttpClient';

export type RefreshOutcome = 'REFRESHED' | 'SIGNED_OUT' | 'RETRYABLE';

/** What the API client needs from the session (implemented by AuthService). */
export interface SessionTokenSource {
  /** In-memory access token, or null (signed out, or not refreshed yet after a restart). */
  peekAccessToken(): string | null;
  hasSession(): boolean;
  /** Single-flight refresh: concurrent callers share one /auth/refresh request. */
  refreshOnce(): Promise<RefreshOutcome>;
  /** The server no longer accepts this device for the account; the session must end locally. */
  endSessionLocally(reason: string): Promise<void>;
}

const DEVICE_NOT_AUTHORIZED = 'Device is not authorized';

/**
 * Authenticated requests: Bearer token → on 401, refresh once → retry once.
 * Never loops: a second 401 after a successful refresh is returned as an error.
 */
export class ApiClient {
  constructor(
    private readonly http: HttpClient,
    private readonly session: SessionTokenSource
  ) {}

  public isConfigured(): boolean {
    return this.http.isConfigured();
  }

  public async authorizedRequest<T>(req: HttpRequest): Promise<ApiResult<T>> {
    if (!this.http.isConfigured()) return { ok: false, error: { kind: 'NOT_CONFIGURED' } };
    if (!this.session.hasSession()) return { ok: false, error: { kind: 'SIGNED_OUT' } };

    // After an app restart only the refresh token is stored; obtain an access token first.
    let token = this.session.peekAccessToken();
    if (!token) {
      const outcome = await this.session.refreshOnce();
      if (outcome === 'SIGNED_OUT') return { ok: false, error: { kind: 'SIGNED_OUT' } };
      token = this.session.peekAccessToken();
      if (outcome === 'RETRYABLE' || !token) {
        return { ok: false, error: { kind: 'NETWORK', message: 'Could not refresh session' } };
      }
    }

    const first = await this.send<T>(req, token);
    if (first.ok || first.error.kind !== 'HTTP') return first;

    if (first.error.status === 403 && (first.error.detail ?? '').startsWith(DEVICE_NOT_AUTHORIZED)) {
      await this.session.endSessionLocally('Device is no longer authorized for this account');
      return { ok: false, error: { kind: 'SIGNED_OUT' } };
    }
    if (first.error.status !== 401) return first;

    const outcome = await this.session.refreshOnce();
    if (outcome === 'SIGNED_OUT') return { ok: false, error: { kind: 'SIGNED_OUT' } };
    const refreshed = this.session.peekAccessToken();
    if (outcome === 'RETRYABLE' || !refreshed) return first;

    return this.send<T>(req, refreshed);
  }

  private send<T>(req: HttpRequest, token: string): Promise<ApiResult<T>> {
    return this.http.request<T>({ ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } });
  }
}
