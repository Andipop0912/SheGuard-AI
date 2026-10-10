/**
 * Client-side credential rules matching backend/app/schemas/auth.py.
 *
 * Phone numbers are normalized to E.164 so "+91 98765 43210", "9876543210" and "09876543210" are
 * the same account (the backend stores the string as given). Default country: India (+91).
 */
export const DEFAULT_COUNTRY_CODE = '91';
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 100;
/** bcrypt only uses the first 72 bytes; longer passwords would be silently truncated server-side. */
export const PASSWORD_MAX_BYTES = 72;

export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (/[^\d\s\-().+]/.test(trimmed) || (trimmed.lastIndexOf('+') > 0)) return null;

  let e164: string;
  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+${DEFAULT_COUNTRY_CODE}${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    e164 = `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  } else if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    e164 = `+${digits}`;
  } else {
    return null;
  }
  // E.164: up to 15 digits, no leading zero; backend accepts 8–20 characters.
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH || utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    return 'Password is too long.';
  }
  return null;
}
