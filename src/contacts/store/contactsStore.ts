import { create } from 'zustand';
import { AppContainer } from '../../app/di/AppContainer';
import {
  TrustedContact,
  TrustedContactInput,
  activationBlockedReason,
  addBlockedReason,
  sortByPriority,
  validateContactInput,
} from '../domain/TrustedContact';

export type ContactsLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type MutationResult = { ok: true } | { ok: false; message: string };

interface ContactsStoreState {
  contacts: TrustedContact[];
  loadState: ContactsLoadState;
  error: string | null;
  signedOut: boolean;

  load: () => Promise<void>;
  create: (input: TrustedContactInput) => Promise<MutationResult>;
  update: (id: string, input: TrustedContactInput) => Promise<MutationResult>;
  setActive: (id: string, active: boolean) => Promise<MutationResult>;
  remove: (id: string) => Promise<MutationResult>;
  /** Signed out: forget the cached list. */
  clear: () => void;
}

const repo = () => AppContainer.getInstance().contactsRepository;

export const useContactsStore = create<ContactsStoreState>((set, get) => ({
  contacts: [],
  loadState: 'idle',
  error: null,
  signedOut: false,

  load: async () => {
    set({ loadState: 'loading', error: null });
    const res = await repo().list();
    if (res.ok) set({ contacts: sortByPriority(res.value), loadState: 'ready', signedOut: false });
    else set({ loadState: 'error', error: res.message, signedOut: res.signedOut });
  },

  create: async (input) => {
    const { contacts } = get();
    const blocked = addBlockedReason(contacts) ?? (input.isActive ? activationBlockedReason(contacts, null) : null);
    if (blocked) return { ok: false, message: blocked };
    const { errors, normalizedPhone } = validateContactInput(input, contacts, null);
    const firstError = Object.values(errors)[0];
    if (firstError || !normalizedPhone) return { ok: false, message: firstError ?? 'Invalid contact.' };

    const res = await repo().create({ ...input, phone: normalizedPhone });
    if (!res.ok) return { ok: false, message: res.message };
    set({ contacts: sortByPriority([...get().contacts, res.value]) });
    return { ok: true };
  },

  update: async (id, input) => {
    const { contacts } = get();
    const current = contacts.find((c) => c.id === id);
    if (input.isActive && current && !current.isActive) {
      const blocked = activationBlockedReason(contacts, id);
      if (blocked) return { ok: false, message: blocked };
    }
    const { errors, normalizedPhone } = validateContactInput(input, contacts, id);
    const firstError = Object.values(errors)[0];
    if (firstError || !normalizedPhone) return { ok: false, message: firstError ?? 'Invalid contact.' };

    const res = await repo().update(id, { ...input, phone: normalizedPhone });
    if (!res.ok) return { ok: false, message: res.message };
    set({ contacts: sortByPriority(get().contacts.map((c) => (c.id === id ? res.value : c))) });
    return { ok: true };
  },

  setActive: async (id, active) => {
    if (active) {
      const blocked = activationBlockedReason(get().contacts, id);
      if (blocked) return { ok: false, message: blocked };
    }
    const res = await repo().update(id, { isActive: active });
    if (!res.ok) return { ok: false, message: res.message };
    set({ contacts: sortByPriority(get().contacts.map((c) => (c.id === id ? res.value : c))) });
    return { ok: true };
  },

  remove: async (id) => {
    const res = await repo().remove(id);
    if (!res.ok) return { ok: false, message: res.message };
    set({ contacts: get().contacts.filter((c) => c.id !== id) });
    return { ok: true };
  },

  clear: () => set({ contacts: [], loadState: 'idle', error: null, signedOut: true }),
}));
