/**
 * Session state. Authentication never controls whether SOS works; it only decides whether
 * emergencies can be backed up to the server.
 *
 * There is no ERROR session state: a failed sign-in is a result shown on the form while the
 * session stays UNAUTHENTICATED.
 */
export enum AuthState {
  /** Stored session not read yet (app launch). */
  UNKNOWN = 'UNKNOWN',
  /** Sign-in / registration request in progress. */
  AUTHENTICATING = 'AUTHENTICATING',
  AUTHENTICATED = 'AUTHENTICATED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
}

/** Non-secret session facts that the UI may show. Tokens are never part of this type. */
export interface Session {
  readonly userId: string;
  readonly deviceId: string;
  readonly phone: string;
}

export type AuthResult = { ok: true; session: Session } | { ok: false; message: string };
