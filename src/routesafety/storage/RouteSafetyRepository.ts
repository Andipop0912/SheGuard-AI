declare const require: any;

import { RouteSafetySession } from '../domain/RouteSafetySession';

let AsyncStorage: any = null;
try {
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
} catch {
  AsyncStorage = null;
}

const ROUTE_SAFETY_SESSIONS_KEY = '@sheguard_route_safety_sessions_v1';

/**
 * Local-first storage for Route Safety sessions, mirroring EmergencyStorageRepository: the
 * device's own durable copy, survives app restart, independent of the backend.
 */
export class RouteSafetyRepository {
  private inMemoryCache: Map<string, RouteSafetySession> = new Map();
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    if (!AsyncStorage) return;
    try {
      const jsonValue = await AsyncStorage.getItem(ROUTE_SAFETY_SESSIONS_KEY);
      if (jsonValue != null) {
        const sessions: RouteSafetySession[] = JSON.parse(jsonValue);
        sessions.forEach((s) => this.inMemoryCache.set(s.sessionId, s));
      }
    } catch {
      // Storage unavailable: sessions stay in-memory only for this run.
    }
  }

  private async persist(): Promise<void> {
    if (!AsyncStorage) return;
    try {
      await AsyncStorage.setItem(ROUTE_SAFETY_SESSIONS_KEY, JSON.stringify(Array.from(this.inMemoryCache.values())));
    } catch {
      // Best-effort.
    }
  }

  public async save(session: RouteSafetySession): Promise<RouteSafetySession> {
    await this.ready;
    this.inMemoryCache.set(session.sessionId, session);
    await this.persist();
    return session;
  }

  public async getSession(sessionId: string): Promise<RouteSafetySession | null> {
    await this.ready;
    return this.inMemoryCache.get(sessionId) ?? null;
  }

  /** The single ACTIVE session, if any — there is only ever one at a time by construction. */
  public async getActiveSession(): Promise<RouteSafetySession | null> {
    await this.ready;
    for (const session of this.inMemoryCache.values()) {
      if (session.status === 'ACTIVE') return session;
    }
    return null;
  }

  public async getAllSessions(): Promise<RouteSafetySession[]> {
    await this.ready;
    return Array.from(this.inMemoryCache.values()).sort((a, b) => b.startedAt - a.startedAt);
  }
}
