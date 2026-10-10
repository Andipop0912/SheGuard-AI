/**
 * A trusted contact (server-owned; the backend is authoritative for every rule below).
 * Only ACTIVE contacts are alerted in an emergency, and the server chooses them.
 */
export interface TrustedContact {
  readonly id: string;
  readonly name: string;
  /** Normalized +91XXXXXXXXXX. */
  readonly phone: string;
  readonly relationship: string | null;
  /** 1 = highest. Alerts go out in priority order. */
  readonly priority: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrustedContactInput {
  name: string;
  phone: string;
  relationship: string | null;
  priority: number;
  isActive: boolean;
}

/** Mirrors backend MAX_TRUSTED_CONTACTS / MAX_ACTIVE_TRUSTED_CONTACTS (server still enforces them). */
export const MAX_TRUSTED_CONTACTS = 10;
export const MAX_ACTIVE_TRUSTED_CONTACTS = 5;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 100;
export const MAX_NAME_LENGTH = 100;
export const MAX_RELATIONSHIP_LENGTH = 50;

/**
 * Indian mobile numbers only (SMS provider is India-only). Same rule as the backend:
 * optional +91 / 91 / 0 prefix, then 10 digits starting 6–9 → "+91XXXXXXXXXX".
 */
export function normalizeIndianMobile(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(cleaned);
  return match ? `+91${match[1]}` : null;
}

/** "+919876543210" → "+91 98765 43210" (display only). */
export function formatIndianMobile(normalized: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(normalized);
  return m ? `+91 ${m[1]} ${m[2]}` : normalized;
}

export interface ContactValidation {
  name?: string;
  phone?: string;
  relationship?: string;
  priority?: string;
}

/** Client-side checks mirroring the backend, so the user gets the reason before submitting. */
export function validateContactInput(
  input: TrustedContactInput,
  existing: readonly TrustedContact[],
  editingId: string | null
): { errors: ContactValidation; normalizedPhone: string | null } {
  const errors: ContactValidation = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters.`;

  const normalizedPhone = normalizeIndianMobile(input.phone);
  if (!normalizedPhone) {
    errors.phone = 'Enter a valid Indian mobile number (10 digits, optionally with +91).';
  } else if (existing.some((c) => c.phone === normalizedPhone && c.id !== editingId)) {
    errors.phone = 'This number is already one of your trusted contacts.';
  }

  if (input.relationship && input.relationship.trim().length > MAX_RELATIONSHIP_LENGTH) {
    errors.relationship = `Relationship must be at most ${MAX_RELATIONSHIP_LENGTH} characters.`;
  }
  if (!Number.isInteger(input.priority) || input.priority < MIN_PRIORITY || input.priority > MAX_PRIORITY) {
    errors.priority = `Priority must be between ${MIN_PRIORITY} and ${MAX_PRIORITY}.`;
  }
  return { errors, normalizedPhone };
}

export function activeCount(contacts: readonly TrustedContact[]): number {
  return contacts.filter((c) => c.isActive).length;
}

/** Why another contact cannot be added, or null. */
export function addBlockedReason(contacts: readonly TrustedContact[]): string | null {
  return contacts.length >= MAX_TRUSTED_CONTACTS
    ? `You can have at most ${MAX_TRUSTED_CONTACTS} trusted contacts. Remove one to add another.`
    : null;
}

/** Why a contact cannot be activated, or null. */
export function activationBlockedReason(contacts: readonly TrustedContact[], contactId: string | null): string | null {
  const othersActive = contacts.filter((c) => c.isActive && c.id !== contactId).length;
  return othersActive >= MAX_ACTIVE_TRUSTED_CONTACTS
    ? `You can have at most ${MAX_ACTIVE_TRUSTED_CONTACTS} active trusted contacts. Deactivate one first.`
    : null;
}

export function sortByPriority(contacts: readonly TrustedContact[]): TrustedContact[] {
  return [...contacts].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}
