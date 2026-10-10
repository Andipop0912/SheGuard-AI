declare const require: any;

import { EvidenceItem } from '../domain/EvidenceItem';

let AsyncStorage: any = null;
try {
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
} catch {
  AsyncStorage = null;
}

const EVIDENCE_ITEMS_KEY = '@sheguard_evidence_items_v1';

/** Local-only metadata store for recorded evidence. Never contacts the network. */
export class EvidenceRepository {
  private inMemoryCache: Map<string, EvidenceItem> = new Map();
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    if (!AsyncStorage) return;
    try {
      const jsonValue = await AsyncStorage.getItem(EVIDENCE_ITEMS_KEY);
      if (jsonValue != null) {
        const items: EvidenceItem[] = JSON.parse(jsonValue);
        items.forEach((item) => this.inMemoryCache.set(item.evidenceId, item));
      }
    } catch {
      // Storage unavailable: evidence metadata stays in-memory only for this session.
    }
  }

  private async persist(): Promise<void> {
    if (!AsyncStorage) return;
    try {
      await AsyncStorage.setItem(EVIDENCE_ITEMS_KEY, JSON.stringify(Array.from(this.inMemoryCache.values())));
    } catch {
      // Best-effort: evidence already saved locally as a file either way.
    }
  }

  public async save(item: EvidenceItem): Promise<void> {
    await this.ready;
    this.inMemoryCache.set(item.evidenceId, item);
    await this.persist();
  }

  public async updateSyncStatus(evidenceId: string, syncStatus: EvidenceItem['syncStatus']): Promise<void> {
    await this.ready;
    const item = this.inMemoryCache.get(evidenceId);
    if (!item) return;
    this.inMemoryCache.set(evidenceId, { ...item, syncStatus });
    await this.persist();
  }

  public async getForEvent(eventId: string): Promise<EvidenceItem[]> {
    await this.ready;
    return Array.from(this.inMemoryCache.values())
      .filter((item) => item.eventId === eventId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  public async getAll(): Promise<EvidenceItem[]> {
    await this.ready;
    return Array.from(this.inMemoryCache.values());
  }
}
