/**
 * Verified Indian government helpline numbers (Phase 3F).
 *
 * This list is LOCKED: exactly these five services, in exactly this order. It ships inside the
 * app (no backend, no network, no auth) so it is available offline, and it is the ONLY source
 * the Legal Help screen may dial from — nothing here accepts a user-supplied number.
 */

export type HelplineCategory = 'emergency' | 'women' | 'legalAid' | 'cyberCrime' | 'child';

export interface Helpline {
  readonly id: string;
  readonly name: string;
  /** Dialable number, digits only (no spaces/dashes) — exactly as published by the source. */
  readonly number: string;
  readonly description: string;
  readonly category: HelplineCategory;
  /** The authority that publishes this number (for the "Source" / "Verified information" view). */
  readonly source: {
    readonly organization: string;
    readonly url: string;
  };
  /** Date this entry's number/organization was last confirmed against the source, not a live check. */
  readonly verifiedAt: string;
  readonly enabled: boolean;
}

/**
 * LOCKED verified dataset. Do not add, remove, substitute, or reorder entries without updating
 * this comment and re-verifying against the official source listed for each one.
 */
export const HELPLINES: readonly Helpline[] = [
  {
    id: 'emergency-112',
    name: 'Emergency',
    number: '112',
    description: 'Police / Fire / Ambulance / emergency assistance',
    category: 'emergency',
    source: { organization: 'India Government / Emergency Response Support System', url: 'https://www.india.gov.in/' },
    verifiedAt: '2026-10-07',
    enabled: true,
  },
  {
    id: 'women-181',
    name: 'Women Helpline',
    number: '181',
    description: 'Women’s support and assistance',
    category: 'women',
    source: { organization: 'Ministry of Women & Child Development', url: 'https://wcd.gov.in/' },
    verifiedAt: '2026-10-07',
    enabled: true,
  },
  {
    id: 'legal-aid-15100',
    name: 'Free Legal Aid',
    number: '15100',
    description: 'NALSA legal assistance',
    category: 'legalAid',
    source: { organization: 'National Legal Services Authority (NALSA)', url: 'https://nalsa.gov.in/' },
    verifiedAt: '2026-10-07',
    enabled: true,
  },
  {
    id: 'cyber-crime-1930',
    name: 'Cyber Crime',
    number: '1930',
    description: 'National Cyber Crime Helpline',
    category: 'cyberCrime',
    source: {
      organization: 'Indian Cybercrime Coordination Centre / National Cyber Crime Reporting Portal',
      url: 'https://www.cybercrime.gov.in/',
    },
    verifiedAt: '2026-10-07',
    enabled: true,
  },
  {
    id: 'child-1098',
    name: 'Child Helpline',
    number: '1098',
    description: 'Child protection and assistance',
    category: 'child',
    source: { organization: 'Ministry of Women & Child Development', url: 'https://wcd.gov.in/' },
    verifiedAt: '2026-10-07',
    enabled: true,
  },
] as const;

/** The subset actually shown/dialable — still in the locked display order. */
export function getEnabledHelplines(): readonly Helpline[] {
  return HELPLINES.filter((h) => h.enabled);
}

/**
 * The ONLY way the dial action may resolve a number: it must be an exact match to one of the
 * bundled, verified entries. An arbitrary or user-supplied number is never accepted — this
 * function has no code path that returns anything it was not given from the dataset above.
 */
export function findDialableHelpline(id: string): Helpline | null {
  return HELPLINES.find((h) => h.id === id && h.enabled) ?? null;
}
