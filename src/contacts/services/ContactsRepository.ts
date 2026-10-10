import { ApiClient } from '../../api/ApiClient';
import { ApiError } from '../../api/HttpClient';
import { TrustedContact, TrustedContactInput } from '../domain/TrustedContact';
import { TrustedContactDto, fromContactDto, isContactDto, toContactWriteDto } from '../api/contactsDto';

export type ContactsResult<T> = { ok: true; value: T } | { ok: false; message: string; signedOut: boolean };

/**
 * Trusted contacts on the server, through the existing authenticated ApiClient.
 * The server owns contacts and enforces ownership, limits, normalization and duplicates.
 */
export class ContactsRepository {
  constructor(private readonly api: ApiClient) {}

  public async list(): Promise<ContactsResult<TrustedContact[]>> {
    const res = await this.api.authorizedRequest<unknown>({ method: 'GET', path: '/contacts?include_inactive=true' });
    if (!res.ok) return failure(res.error);
    if (!Array.isArray(res.data) || !res.data.every(isContactDto)) {
      return { ok: false, message: 'The server sent an unexpected response.', signedOut: false };
    }
    return { ok: true, value: (res.data as TrustedContactDto[]).map(fromContactDto) };
  }

  public async create(input: TrustedContactInput): Promise<ContactsResult<TrustedContact>> {
    const res = await this.api.authorizedRequest<unknown>({
      method: 'POST',
      path: '/contacts',
      body: toContactWriteDto(input),
    });
    return toContactResult(res);
  }

  public async update(id: string, patch: Partial<TrustedContactInput>): Promise<ContactsResult<TrustedContact>> {
    const res = await this.api.authorizedRequest<unknown>({
      method: 'PATCH',
      path: `/contacts/${encodeURIComponent(id)}`,
      body: toContactWriteDto(patch),
    });
    return toContactResult(res);
  }

  /** Soft delete on the server: alerts stop, history is kept. */
  public async remove(id: string): Promise<ContactsResult<null>> {
    const res = await this.api.authorizedRequest<unknown>({ method: 'DELETE', path: `/contacts/${encodeURIComponent(id)}` });
    if (!res.ok) return failure(res.error);
    return { ok: true, value: null };
  }
}

function toContactResult(
  res: Awaited<ReturnType<ApiClient['authorizedRequest']>>
): ContactsResult<TrustedContact> {
  if (!res.ok) return failure(res.error);
  if (!isContactDto(res.data)) return { ok: false, message: 'The server sent an unexpected response.', signedOut: false };
  return { ok: true, value: fromContactDto(res.data) };
}

export function describeContactsError(error: ApiError): string {
  switch (error.kind) {
    case 'SIGNED_OUT':
      return 'Sign in to manage trusted contacts.';
    case 'NOT_CONFIGURED':
      return 'The SheGuard server is not configured in this build.';
    case 'NETWORK':
    case 'TIMEOUT':
      return 'Can’t reach the SheGuard server. Check your connection and try again.';
    case 'HTTP':
      // The server's own reason for 409 (limits, duplicates) and 422 (invalid number) is user-facing.
      if ((error.status === 409 || error.status === 422 || error.status === 404) && error.detail) return error.detail;
      return 'The server could not complete the request. Try again later.';
    default:
      return 'Something went wrong. Try again.';
  }
}

function failure<T>(error: ApiError): ContactsResult<T> {
  return { ok: false, message: describeContactsError(error), signedOut: error.kind === 'SIGNED_OUT' };
}
