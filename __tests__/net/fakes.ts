import { FetchFn } from '../../src/api/HttpClient';
import { SecureStore } from '../../src/auth/storage/SecureStore';

/**
 * In-memory stand-in for the FastAPI backend, reproducing the behaviour verified in the Phase 3C
 * audit: register/login bind the device, refresh tokens rotate (old one revoked), access tokens
 * carry the device, /emergencies/sync is idempotent by eventId + updatedAt and enforces
 * user/device ownership.
 */
export interface FakeCall {
  method: string;
  path: string;
  authorization: string | null;
  body: any;
}

interface FakeEvent {
  eventId: string;
  userId: string;
  deviceId: string;
  state: string;
  triggerSource: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export const FAKE_BASE_URL = 'http://fake.test/api/v1';

export class FakeBackend {
  public offline = false;
  /** Requests whose fetch never settles (until aborted by the client timeout). */
  public hang = false;
  /** Forced HTTP status for the next N matching requests: [{ path, status }]. */
  public forced: { path: string; status: number; detail?: string }[] = [];
  public readonly calls: FakeCall[] = [];
  public readonly events = new Map<string, FakeEvent>();
  /** Like the real server's dispatch: called when an emergency first arrives. */
  public onEventInserted: ((eventId: string) => void) | null = null;

  private seq = 0;
  private readonly users = new Map<string, { id: string; password: string; active: boolean }>();
  private readonly devices = new Map<string, boolean>(); // `${userId}|${deviceId}` → active
  private readonly refreshTokens = new Map<string, { userId: string; deviceId: string; revoked: boolean }>();
  private readonly accessTokens = new Map<string, { userId: string; deviceId: string; valid: boolean }>();

  public readonly fetch: FetchFn = (input, init) => this.handle(input, init);

  public callsTo(path: string): FakeCall[] {
    return this.calls.filter((c) => c.path === path);
  }

  public expireAccessTokens(): void {
    this.accessTokens.forEach((t) => (t.valid = false));
  }

  public revokeAllRefreshTokens(): void {
    this.refreshTokens.forEach((t) => (t.revoked = true));
  }

  public deactivateDevice(userId: string, deviceId: string): void {
    this.devices.set(`${userId}|${deviceId}`, false);
  }

  public setUserActive(phone: string, active: boolean): void {
    const user = this.users.get(phone);
    if (user) user.active = active;
  }

  /** True only for a refresh token the server would still accept. */
  public isRefreshTokenActive(token: string): boolean {
    const session = this.refreshTokens.get(token);
    return !!session && !session.revoked;
  }

  public activeRefreshTokenCount(): number {
    return Array.from(this.refreshTokens.values()).filter((t) => !t.revoked).length;
  }

  /** Seeds a user directly (no HTTP call recorded). */
  public seedUser(phone: string, password: string): string {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.users.set(phone, { id, password, active: true });
    return id;
  }

  private async handle(input: string, init?: RequestInit): Promise<Response> {
    const path = input.replace(FAKE_BASE_URL, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    this.calls.push({ method: init?.method ?? 'GET', path, authorization: headers.Authorization ?? null, body });

    if (this.offline) throw new TypeError('Network request failed');
    if (this.hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    const forcedIndex = this.forced.findIndex((f) => f.path === path);
    if (forcedIndex >= 0) {
      const [f] = this.forced.splice(forcedIndex, 1);
      return respond(f.status, { detail: f.detail ?? 'Forced failure' });
    }

    switch (path) {
      case '/auth/register':
        return this.register(body);
      case '/auth/login':
        return this.login(body);
      case '/auth/refresh':
        return this.refresh(body);
      case '/auth/logout':
        return this.logout(body);
      case '/emergencies/sync':
        return this.sync(headers.Authorization ?? null, body);
      default:
        if (path.startsWith('/contacts')) return this.contactsRoute(init?.method ?? 'GET', path, headers.Authorization ?? null, body);
        if (path.startsWith('/emergency/communication/logs/')) {
          return this.logsRoute(path.slice('/emergency/communication/logs/'.length), headers.Authorization ?? null);
        }
        return respond(404, { detail: 'Not Found' });
    }
  }

  // ---------- trusted contacts (mirrors backend/app/services/contact_service.py) ----------

  /** userId → contacts (deleted ones kept as history). */
  public readonly contacts = new Map<string, FakeContact[]>();
  /** eventId → server communication records (snake_case, as GET /emergency/communication/logs returns). */
  public readonly communicationLogs = new Map<string, Record<string, unknown>[]>();

  private authUser(authorization: string | null): { userId: string } | Response {
    if (!authorization) return respond(403, { detail: 'Not authenticated' });
    const token = this.accessTokens.get(authorization.replace('Bearer ', ''));
    if (!token || !token.valid) return respond(401, { detail: 'Could not validate authentication credentials' });
    return { userId: token.userId };
  }

  private contactsRoute(method: string, path: string, authorization: string | null, body: any): Response {
    const auth = this.authUser(authorization);
    if (!('userId' in auth)) return auth;
    const list = this.contacts.get(auth.userId) ?? [];
    this.contacts.set(auth.userId, list);
    const live = () => list.filter((c) => !c.deleted);
    const id = path.split('?')[0].split('/')[2];

    if (!id && method === 'GET') {
      const includeInactive = path.includes('include_inactive=true');
      return respond(200, live().filter((c) => includeInactive || c.is_active).sort(byPriority));
    }
    if (!id && method === 'POST') {
      const phone = normalizeIndian(body?.phone);
      if (!phone || !String(body?.name ?? '').trim()) {
        return respond(422, { detail: [{ msg: 'Value error, Enter a valid Indian mobile number (10 digits, optionally with +91)' }] });
      }
      if (live().length >= 10) return respond(409, { detail: 'You can have at most 10 trusted contacts. Remove one first.' });
      if (live().some((c) => c.phone === phone)) return respond(409, { detail: 'This number is already one of your trusted contacts.' });
      const isActive = body.is_active !== false;
      if (isActive && live().filter((c) => c.is_active).length >= 5) {
        return respond(409, { detail: 'You can have at most 5 active trusted contacts. Deactivate one first.' });
      }
      const now = new Date(Date.now() + this.seq).toISOString();
      const contact: FakeContact = {
        id: `00000000-0000-4000-9000-${String(++this.seq).padStart(12, '0')}`,
        user_id: auth.userId,
        name: String(body.name).trim(),
        phone,
        relationship: body.relationship ?? null,
        priority: body.priority ?? 1,
        is_active: isActive,
        created_at: now,
        updated_at: now,
        deleted: false,
      };
      list.push(contact);
      return respond(201, publicContact(contact));
    }
    const contact = live().find((c) => c.id === id);
    if (!contact) return respond(404, { detail: 'Trusted contact not found or does not belong to user' });
    if (method === 'PATCH') {
      if (body.phone !== undefined) {
        const phone = normalizeIndian(body.phone);
        if (!phone) return respond(422, { detail: [{ msg: 'Value error, Enter a valid Indian mobile number' }] });
        if (live().some((c) => c.phone === phone && c.id !== id)) {
          return respond(409, { detail: 'This number is already one of your trusted contacts.' });
        }
        contact.phone = phone;
      }
      if (body.is_active === true && !contact.is_active && live().filter((c) => c.is_active).length >= 5) {
        return respond(409, { detail: 'You can have at most 5 active trusted contacts. Deactivate one first.' });
      }
      for (const key of ['name', 'relationship', 'priority', 'is_active'] as const) {
        if (body[key] !== undefined && body[key] !== null) (contact as any)[key] = body[key];
      }
      contact.updated_at = new Date().toISOString();
      return respond(200, publicContact(contact));
    }
    if (method === 'DELETE') {
      contact.deleted = true;
      contact.is_active = false;
      return { ok: true, status: 204, text: async () => '' } as unknown as Response;
    }
    return respond(405, { detail: 'Method Not Allowed' });
  }

  private logsRoute(eventId: string, authorization: string | null): Response {
    const auth = this.authUser(authorization);
    if (!('userId' in auth)) return auth;
    const event = this.events.get(decodeURIComponent(eventId));
    if (!event) return respond(404, { detail: 'Emergency event not found' });
    if (event.userId !== auth.userId) return respond(403, { detail: 'Emergency event does not belong to authenticated user' });
    return respond(200, this.communicationLogs.get(event.eventId) ?? []);
  }

  private issue(userId: string, deviceId: string) {
    const accessToken = `at-${++this.seq}`;
    const refreshToken = `rt-${++this.seq}`;
    this.accessTokens.set(accessToken, { userId, deviceId, valid: true });
    this.refreshTokens.set(refreshToken, { userId, deviceId, revoked: false });
    return { accessToken, refreshToken, tokenType: 'bearer', userId, deviceId };
  }

  private register(body: any): Response {
    if (typeof body?.phone !== 'string' || body.phone.length < 8 || typeof body.password !== 'string' || body.password.length < 6) {
      return respond(422, { detail: [{ msg: 'String should have at least 6 characters' }] });
    }
    if (this.users.has(body.phone)) return respond(400, { detail: 'User with this phone number already exists.' });
    const userId = this.seedUser(body.phone, body.password);
    this.devices.set(`${userId}|${body.deviceId}`, true);
    return respond(201, this.issue(userId, body.deviceId));
  }

  private login(body: any): Response {
    const user = this.users.get(body?.phone);
    if (!user || user.password !== body.password) return respond(401, { detail: 'Invalid phone number or password.' });
    if (!user.active) return respond(403, { detail: 'User account is inactive.' });
    this.devices.set(`${user.id}|${body.deviceId}`, true);
    return respond(200, this.issue(user.id, body.deviceId));
  }

  private refresh(body: any): Response {
    const session = this.refreshTokens.get(body?.refreshToken);
    if (!session || session.revoked || session.deviceId !== body.deviceId) {
      return respond(401, { detail: 'Invalid or revoked refresh token.' });
    }
    if (!this.devices.get(`${session.userId}|${session.deviceId}`)) {
      return respond(401, { detail: 'Device is not authorized for this account.' });
    }
    session.revoked = true;
    return respond(200, this.issue(session.userId, session.deviceId));
  }

  private logout(body: any): Response {
    const session = this.refreshTokens.get(body?.refreshToken);
    const success = !!session && !session.revoked;
    if (session) session.revoked = true;
    return respond(200, { success, message: success ? 'Logged out successfully' : 'Token already revoked or invalid' });
  }

  private sync(authorization: string | null, body: any): Response {
    if (!authorization) return respond(403, { detail: 'Not authenticated' });
    const token = this.accessTokens.get(authorization.replace('Bearer ', ''));
    if (!token || !token.valid) return respond(401, { detail: 'Could not validate authentication credentials' });
    if (!this.devices.get(`${token.userId}|${token.deviceId}`)) {
      return respond(403, { detail: 'Device is not authorized or bound to this user' });
    }
    const now = new Date().toISOString();
    const results = (body.events as FakeEvent[]).map((dto) => {
      if (dto.userId !== token.userId || dto.deviceId !== token.deviceId) {
        return { eventId: dto.eventId, status: 'FAILED', serverReceivedAt: now, message: 'User ID or Device ID mismatch with authenticated session.' };
      }
      const existing = this.events.get(dto.eventId);
      if (existing && (existing.userId !== token.userId || existing.deviceId !== token.deviceId)) {
        return { eventId: dto.eventId, status: 'FAILED', serverReceivedAt: now, message: 'Emergency event not found for this account and device.' };
      }
      if (!existing) {
        this.events.set(dto.eventId, { ...dto });
        this.onEventInserted?.(dto.eventId);
        return { eventId: dto.eventId, status: 'SYNCED', serverReceivedAt: now };
      }
      if (dto.updatedAt > existing.updatedAt) {
        this.events.set(dto.eventId, { ...existing, state: dto.state, updatedAt: dto.updatedAt, resolvedAt: dto.resolvedAt ?? existing.resolvedAt });
        return { eventId: dto.eventId, status: 'UPDATED', serverReceivedAt: now };
      }
      return { eventId: dto.eventId, status: 'ALREADY_SYNCED', serverReceivedAt: now };
    });
    return respond(200, { results });
  }
}

interface FakeContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

function normalizeIndian(raw: unknown): string | null {
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(String(raw ?? '').replace(/[\s\-()]/g, ''));
  return match ? `+91${match[1]}` : null;
}

function publicContact(c: FakeContact) {
  const { deleted: _deleted, ...rest } = c;
  return rest;
}

function byPriority(a: FakeContact, b: FakeContact): number {
  return a.priority - b.priority || a.created_at.localeCompare(b.created_at);
}

/** A server communication record as GET /emergency/communication/logs returns it. */
export function fakeCommunicationLog(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `log-${Math.random().toString(16).slice(2)}`,
    event_id: 'evt',
    contact_id: 'c',
    contact_name: 'Mom',
    contact_phone: '+919876543210',
    contact_deleted: false,
    channel: 'SMS',
    status: 'PROVIDER_ACCEPTED',
    reason_code: null,
    failure_reason: null,
    is_simulated: true,
    attempt_count: 1,
    provider_message_id: 'mock_sms_acc_x',
    attempted_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function respond(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

/** Secure store whose operations can be made to fail. */
export class FlakySecureStore implements SecureStore {
  public readonly values = new Map<string, string>();
  public failReads = false;
  public failWrites = false;

  public async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('Keystore unavailable');
    return this.values.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('Keystore unavailable');
    this.values.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/** Waits for pending timers/microtasks (requestFlush uses setTimeout 0). */
export const settle = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

// ---------- stack builder: real services over the fake backend ----------
import { HttpClient } from '../../src/api/HttpClient';
import { ApiClient } from '../../src/api/ApiClient';
import { AuthService } from '../../src/auth/services/AuthService';
import { EmergencyStorageRepository } from '../../src/storage/EmergencyStorageRepository';
import { EmergencyCoordinator } from '../../src/emergency/services/EmergencyCoordinator';
import { EmergencySyncService } from '../../src/sync/EmergencySyncService';
import { loadInstallDeviceId, setSignedInUser } from '../../src/app/identity';

export interface Stack {
  backend: FakeBackend;
  secureStore: FlakySecureStore;
  http: HttpClient;
  auth: AuthService;
  api: ApiClient;
  repository: EmergencyStorageRepository;
  coordinator: EmergencyCoordinator;
  sync: EmergencySyncService;
}

export function buildStack(
  options: { backend?: FakeBackend; secureStore?: FlakySecureStore; repository?: EmergencyStorageRepository; timeoutMs?: number } = {}
): Stack {
  const backend = options.backend ?? new FakeBackend();
  const secureStore = options.secureStore ?? new FlakySecureStore();
  const http = new HttpClient(() => FAKE_BASE_URL, options.timeoutMs ?? 2_000, backend.fetch);
  const auth = new AuthService({
    http,
    secureStore,
    getDeviceId: loadInstallDeviceId,
    onSignedInUserChanged: setSignedInUser,
    appVersion: 'test',
  });
  const api = new ApiClient(http, auth);
  const repository = options.repository ?? new EmergencyStorageRepository();
  const coordinator = new EmergencyCoordinator(repository);
  const sync = new EmergencySyncService(repository, coordinator, api, auth, {
    batchSize: 20,
    retryInitialMs: 40,
    retryMaxMs: 160,
  });
  return { backend, secureStore, http, auth, api, repository, coordinator, sync };
}
