/**
 * Minimal JSON-over-fetch client. No retries, no auth, no logging of headers or bodies
 * (they may contain passwords or tokens). Every outcome is returned as a value, never thrown.
 */

export type ApiError =
  /** No backend URL configured for this build. */
  | { kind: 'NOT_CONFIGURED' }
  /** Request could not complete (offline, DNS, connection refused). */
  | { kind: 'NETWORK'; message: string }
  | { kind: 'TIMEOUT' }
  /** Server answered with a non-2xx status. `detail` is the server's message, if any. */
  | { kind: 'HTTP'; status: number; detail: string | null }
  /** 2xx response whose body was not valid JSON. */
  | { kind: 'PARSE' }
  /** Authenticated request with no usable session (signed out, refresh rejected, device revoked). */
  | { kind: 'SIGNED_OUT' };

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; error: ApiError };

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** FastAPI errors: {"detail": "text"} or validation {"detail": [{msg, ...}]}. */
export function parseErrorDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: unknown }).msg === 'string' ? (d as { msg: string }).msg : null))
      .filter((m): m is string => !!m);
    return messages.length > 0 ? messages.join('; ') : null;
  }
  return null;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: () => string | null,
    private readonly defaultTimeoutMs: number,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init)
  ) {}

  public isConfigured(): boolean {
    return !!this.baseUrl();
  }

  public async request<T>(req: HttpRequest): Promise<ApiResult<T>> {
    const base = this.baseUrl();
    if (!base) return { ok: false, error: { kind: 'NOT_CONFIGURED' } };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs ?? this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(`${base}${req.path}`, {
        method: req.method,
        headers: {
          Accept: 'application/json',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (timedOut) return { ok: false, error: { kind: 'TIMEOUT' } };
      return { ok: false, error: { kind: 'NETWORK', message: e instanceof Error ? e.message : 'Network error' } };
    }

    try {
      let body: unknown = null;
      const text = await response.text();
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          if (response.ok) return { ok: false, error: { kind: 'PARSE' } };
        }
      }
      if (!response.ok) {
        return { ok: false, error: { kind: 'HTTP', status: response.status, detail: parseErrorDetail(body) } };
      }
      return { ok: true, status: response.status, data: body as T };
    } catch (e) {
      if (timedOut) return { ok: false, error: { kind: 'TIMEOUT' } };
      return { ok: false, error: { kind: 'NETWORK', message: e instanceof Error ? e.message : 'Network error' } };
    } finally {
      clearTimeout(timer);
    }
  }
}
