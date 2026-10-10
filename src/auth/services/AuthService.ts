import { Platform } from 'react-native';
import { ApiError, HttpClient } from '../../api/HttpClient';
import { RefreshOutcome, SessionTokenSource } from '../../api/ApiClient';
import {
  LoginRequestDto,
  LogoutRequestDto,
  RefreshRequestDto,
  RegisterRequestDto,
  TokenResponseDto,
  isTokenResponse,
} from '../../api/dto/authDto';
import { AuthResult, AuthState, Session } from '../domain/AuthState';
import { normalizePhone, validatePassword } from '../credentials';
import { SecureStore } from '../storage/SecureStore';

/** Everything persisted for a session, in ONE secure value so the token pair updates atomically. */
interface StoredSession {
  refreshToken: string;
  userId: string;
  deviceId: string;
  phone: string;
}

const SESSION_KEY = 'sheguard.session.v1';
const LOGOUT_TIMEOUT_MS = 5_000;

export interface AuthServiceDeps {
  http: HttpClient;
  secureStore: SecureStore;
  /** The install device id (identity.ts). */
  getDeviceId: () => Promise<string>;
  /** Keeps identity.ts's event owner in step with the session. */
  onSignedInUserChanged: (userId: string | null) => void;
  appVersion: string;
}

export interface AuthSnapshot {
  state: AuthState;
  session: Session | null;
  /** Why the session ended without the user signing out (e.g. refresh rejected), for the UI. */
  endedReason: string | null;
}

/**
 * Registration, sign-in, refresh, sign-out and session restore.
 *
 * - Refresh token: secure storage only. Access token: memory only.
 * - Restore at launch reads secure storage and never needs the network.
 * - Refresh is single-flight: concurrent 401s share one /auth/refresh call (the backend
 *   rotates refresh tokens, so a second concurrent refresh would be rejected).
 * - Nothing here is ever called by the emergency trigger path.
 */
export class AuthService implements SessionTokenSource {
  private state: AuthState = AuthState.UNKNOWN;
  private stored: StoredSession | null = null;
  private accessToken: string | null = null;
  private endedReason: string | null = null;
  private refreshing: Promise<RefreshOutcome> | null = null;
  private restoring: Promise<void> | null = null;
  private readonly listeners = new Set<(snapshot: AuthSnapshot) => void>();

  constructor(private readonly deps: AuthServiceDeps) {}

  // ---------- observation ----------

  public getSnapshot(): AuthSnapshot {
    return { state: this.state, session: this.getSession(), endedReason: this.endedReason };
  }

  public getSession(): Session | null {
    if (!this.stored) return null;
    return { userId: this.stored.userId, deviceId: this.stored.deviceId, phone: this.stored.phone };
  }

  public subscribe(listener: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private setState(state: AuthState): void {
    this.state = state;
    this.deps.onSignedInUserChanged(this.stored?.userId ?? null);
    const snapshot = this.getSnapshot();
    this.listeners.forEach((l) => l(snapshot));
  }

  // ---------- SessionTokenSource (ApiClient) ----------

  public peekAccessToken(): string | null {
    return this.stored ? this.accessToken : null;
  }

  public hasSession(): boolean {
    return this.stored !== null;
  }

  /** Current access token, refreshing first if needed (used by the location uploader). */
  public async getAccessToken(): Promise<string | null> {
    if (!this.stored) return null;
    if (this.accessToken) return this.accessToken;
    const outcome = await this.refreshOnce();
    return outcome === 'REFRESHED' ? this.accessToken : null;
  }

  public refreshOnce(): Promise<RefreshOutcome> {
    if (!this.refreshing) {
      this.refreshing = this.runRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async runRefresh(): Promise<RefreshOutcome> {
    const stored = this.stored;
    if (!stored) return 'SIGNED_OUT';

    const body: RefreshRequestDto = { refreshToken: stored.refreshToken, deviceId: stored.deviceId };
    const res = await this.deps.http.request<unknown>({ method: 'POST', path: '/auth/refresh', body });

    if (!res.ok) {
      if (res.error.kind === 'HTTP' && (res.error.status === 401 || res.error.status === 403)) {
        await this.endSessionLocally('Your session expired. Sign in again to back up emergencies.');
        return 'SIGNED_OUT';
      }
      // Offline / server error: keep the session; the caller fails honestly and retries later.
      return 'RETRYABLE';
    }
    if (!isTokenResponse(res.data)) return 'RETRYABLE';
    // The user may have signed out while the refresh was in flight.
    if (this.stored !== stored) return this.stored ? 'REFRESHED' : 'SIGNED_OUT';

    // The backend has already revoked the old refresh token: memory must hold the rotated one too,
    // or a later refresh/logout in this run would send a revoked token.
    const next: StoredSession = { ...stored, refreshToken: res.data.refreshToken };
    const persisted = await this.persist(next);
    this.stored = next;
    this.accessToken = res.data.accessToken;
    if (!persisted) {
      // The new refresh token could not be saved; it still works for this run.
      console.warn('[Auth] Refreshed session could not be saved securely');
    }
    return 'REFRESHED';
  }

  public async endSessionLocally(reason: string): Promise<void> {
    this.stored = null;
    this.accessToken = null;
    this.endedReason = reason;
    try {
      await this.deps.secureStore.removeItem(SESSION_KEY);
    } catch {
      // Nothing usable remains in memory either way.
    }
    this.setState(AuthState.UNAUTHENTICATED);
  }

  // ---------- lifecycle ----------

  /** Reads the stored session (no network). Safe to call repeatedly. */
  public restore(): Promise<void> {
    if (!this.restoring) {
      this.restoring = this.runRestore();
    }
    return this.restoring;
  }

  private async runRestore(): Promise<void> {
    let stored: StoredSession | null = null;
    try {
      const raw = await this.deps.secureStore.getItem(SESSION_KEY);
      stored = raw ? parseStoredSession(raw) : null;
    } catch {
      stored = null;
    }
    // A sign-in that completed during restore wins.
    if (this.state !== AuthState.UNKNOWN) return;
    this.stored = stored;
    this.setState(stored ? AuthState.AUTHENTICATED : AuthState.UNAUTHENTICATED);
  }

  public register(phoneInput: string, password: string): Promise<AuthResult> {
    return this.authenticate('register', phoneInput, password);
  }

  public login(phoneInput: string, password: string): Promise<AuthResult> {
    return this.authenticate('login', phoneInput, password);
  }

  private async authenticate(kind: 'register' | 'login', phoneInput: string, password: string): Promise<AuthResult> {
    const phone = normalizePhone(phoneInput);
    if (!phone) return { ok: false, message: 'Enter a valid mobile number.' };
    const passwordError = kind === 'register' ? validatePassword(password) : password.length === 0 ? 'Enter your password.' : null;
    if (passwordError) return { ok: false, message: passwordError };
    if (this.state === AuthState.AUTHENTICATING) return { ok: false, message: 'Already signing in.' };

    const previous = this.state === AuthState.UNKNOWN ? AuthState.UNAUTHENTICATED : this.state;
    this.setState(AuthState.AUTHENTICATING);

    let deviceId: string;
    try {
      deviceId = await this.deps.getDeviceId();
    } catch {
      this.setState(previous);
      return { ok: false, message: 'Could not read this device’s identity. Try again.' };
    }

    const res =
      kind === 'register'
        ? await this.deps.http.request<unknown>({
            method: 'POST',
            path: '/auth/register',
            body: {
              phone,
              password,
              deviceId,
              platform: 'android',
              osVersion: Platform.Version != null ? String(Platform.Version) : null,
              appVersion: this.deps.appVersion,
            } satisfies RegisterRequestDto,
          })
        : await this.deps.http.request<unknown>({
            method: 'POST',
            path: '/auth/login',
            body: { phone, password, deviceId } satisfies LoginRequestDto,
          });

    if (!res.ok) {
      this.setState(previous);
      return { ok: false, message: describeAuthError(kind, res.error) };
    }
    if (!isTokenResponse(res.data)) {
      this.setState(previous);
      return { ok: false, message: 'The server sent an unexpected response. Try again.' };
    }

    const tokens: TokenResponseDto = res.data;
    const next: StoredSession = { refreshToken: tokens.refreshToken, userId: tokens.userId, deviceId, phone };
    if (!(await this.persist(next))) {
      this.setState(previous);
      return { ok: false, message: 'Could not save your session securely on this phone.' };
    }
    this.stored = next;
    this.accessToken = tokens.accessToken;
    this.endedReason = null;
    this.setState(AuthState.AUTHENTICATED);
    return { ok: true, session: this.getSession()! };
  }

  /**
   * Signs out on this phone immediately (offline too). The server session is revoked
   * best-effort. Local emergencies are kept and stay waiting for upload.
   */
  public async logout(): Promise<void> {
    const stored = this.stored;
    this.stored = null;
    this.accessToken = null;
    this.endedReason = null;
    try {
      await this.deps.secureStore.removeItem(SESSION_KEY);
    } catch {
      // In-memory session is already gone.
    }
    this.setState(AuthState.UNAUTHENTICATED);

    if (stored) {
      const body: LogoutRequestDto = { refreshToken: stored.refreshToken };
      await this.deps.http.request({ method: 'POST', path: '/auth/logout', body, timeoutMs: LOGOUT_TIMEOUT_MS });
    }
  }

  private async persist(session: StoredSession): Promise<boolean> {
    try {
      await this.deps.secureStore.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch {
      return false;
    }
  }
}

function parseStoredSession(raw: string): StoredSession | null {
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof v.refreshToken === 'string' &&
      typeof v.userId === 'string' &&
      typeof v.deviceId === 'string' &&
      typeof v.phone === 'string'
    ) {
      return { refreshToken: v.refreshToken, userId: v.userId, deviceId: v.deviceId, phone: v.phone };
    }
  } catch {
    // fall through
  }
  return null;
}

export function describeAuthError(kind: 'register' | 'login', error: ApiError): string {
  switch (error.kind) {
    case 'NOT_CONFIGURED':
      return 'The SheGuard server is not configured in this build.';
    case 'NETWORK':
    case 'TIMEOUT':
      return 'Can’t reach the SheGuard server. Your safety features still work offline.';
    case 'HTTP':
      if (kind === 'login' && error.status === 401) return 'Incorrect mobile number or password.';
      if (error.status === 403) return 'This account is inactive.';
      if (kind === 'register' && error.status === 400) return error.detail ?? 'This mobile number is already registered.';
      if (error.status === 422) return 'Please check your mobile number and password.';
      return 'The server could not complete the request. Try again later.';
    default:
      return 'Something went wrong. Try again.';
  }
}
