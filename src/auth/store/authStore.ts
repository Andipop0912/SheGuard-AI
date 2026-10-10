import { create } from 'zustand';
import { AuthResult, AuthState, Session } from '../domain/AuthState';
import { AppContainer } from '../../app/di/AppContainer';

interface AuthStoreState {
  authState: AuthState;
  session: Session | null;
  /** Why the session ended on its own (e.g. expired), shown once on the account card. */
  endedReason: string | null;

  /** Mirrors AuthService. Idempotent. */
  initialize: () => void;
  login: (phone: string, password: string) => Promise<AuthResult>;
  register: (phone: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthStoreState>((set) => ({
  authState: AuthState.UNKNOWN,
  session: null,
  endedReason: null,

  initialize: () => {
    if (unsubscribe) return;
    unsubscribe = AppContainer.getInstance().authService.subscribe((snapshot) =>
      set({ authState: snapshot.state, session: snapshot.session, endedReason: snapshot.endedReason })
    );
  },

  login: (phone, password) => AppContainer.getInstance().authService.login(phone, password),
  register: (phone, password) => AppContainer.getInstance().authService.register(phone, password),
  logout: () => AppContainer.getInstance().authService.logout(),
}));

/** Tests only. */
export function teardownAuthStoreForTesting(): void {
  unsubscribe?.();
  unsubscribe = null;
}
