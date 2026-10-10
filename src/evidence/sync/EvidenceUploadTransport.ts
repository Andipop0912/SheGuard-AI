import { EvidenceItem } from '../domain/EvidenceItem';

export type EvidenceUploadResult =
  /** No authenticated connection to the backend exists (yet). Item stays LOCAL_ONLY. */
  | { kind: 'NOT_CONNECTED' }
  /** The emergency itself is not on the server yet; retry once it is. */
  | { kind: 'EVENT_NOT_SYNCED' }
  /** Network/server problem; retry with backoff. */
  | { kind: 'RETRYABLE_ERROR'; message: string }
  /** Server permanently rejected this file (e.g. unsupported type); never retry. */
  | { kind: 'REJECTED'; message: string }
  | { kind: 'SUCCESS' };

/** Uploads one recorded evidence item (POST /evidence/{eventId}/items, multipart). */
export interface EvidenceUploadTransport {
  upload(item: EvidenceItem): Promise<EvidenceUploadResult>;
}

/** Default transport until the app has an authenticated API client. Never pretends to upload. */
export class DisconnectedEvidenceUploadTransport implements EvidenceUploadTransport {
  public async upload(): Promise<EvidenceUploadResult> {
    return { kind: 'NOT_CONNECTED' };
  }
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string | null>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const MIME_BY_EXTENSION: Record<string, string> = { m4a: 'audio/m4a', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg' };

function guessMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'audio/m4a';
}

/** Backend transport for when authentication exists. Not wired in by default. */
export class HttpEvidenceUploadTransport implements EvidenceUploadTransport {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly tokens: AccessTokenProvider,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  public async upload(item: EvidenceItem): Promise<EvidenceUploadResult> {
    const token = await this.tokens.getAccessToken();
    if (!token) return { kind: 'NOT_CONNECTED' };

    const form = new FormData();
    form.append('evidenceId', item.evidenceId);
    form.append('durationMs', String(item.durationMs));
    form.append('clientCreatedAt', String(item.createdAt));
    const mimeType = guessMimeType(item.filePath);
    // React Native's networking layer resolves this as a URI, not a bare path — a native absolute
    // path with no scheme fails to read ("Could not retrieve file for contentUri ...").
    const uri = item.filePath.includes('://') ? item.filePath : `file://${item.filePath}`;
    // FormData accepts {uri, name, type} for a file field without reading it into memory first.
    form.append('file', { uri, name: `${item.evidenceId}.m4a`, type: mimeType } as unknown as Blob);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.apiBaseUrl}/evidence/${encodeURIComponent(item.eventId)}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
      });

      if (response.status === 404) return { kind: 'EVENT_NOT_SYNCED' };
      if (response.status === 401 || response.status === 403) return { kind: 'NOT_CONNECTED' };
      if (response.status === 413 || response.status === 415) return { kind: 'REJECTED', message: `HTTP ${response.status}` };
      if (!response.ok) return { kind: 'RETRYABLE_ERROR', message: `HTTP ${response.status}` };
      return { kind: 'SUCCESS' };
    } catch (e) {
      return { kind: 'RETRYABLE_ERROR', message: e instanceof Error ? e.message : 'Network error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
