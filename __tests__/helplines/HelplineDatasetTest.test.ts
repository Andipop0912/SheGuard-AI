import { HELPLINES, getEnabledHelplines, findDialableHelpline } from '../../src/helplines/domain/Helpline';

/**
 * The Phase 3F dataset is LOCKED: exactly these five verified Indian government helplines,
 * in exactly this order, each with source/verification metadata, available with no network.
 */
describe('Helpline dataset (locked, verified)', () => {
  test('1. exactly five helplines exist', () => {
    expect(HELPLINES).toHaveLength(5);
  });

  test('2–6. each required number exists with the exact locked value', () => {
    const byId = Object.fromEntries(HELPLINES.map((h) => [h.id, h]));
    expect(byId['emergency-112']).toMatchObject({ name: 'Emergency', number: '112' });
    expect(byId['women-181']).toMatchObject({ name: 'Women Helpline', number: '181' });
    expect(byId['legal-aid-15100']).toMatchObject({ name: 'Free Legal Aid', number: '15100' });
    expect(byId['cyber-crime-1930']).toMatchObject({ name: 'Cyber Crime', number: '1930' });
    expect(byId['child-1098']).toMatchObject({ name: 'Child Helpline', number: '1098' });
  });

  test('7. display order matches the locked order exactly', () => {
    expect(HELPLINES.map((h) => h.number)).toEqual(['112', '181', '15100', '1930', '1098']);
  });

  test('8. no duplicate numbers', () => {
    const numbers = HELPLINES.map((h) => h.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test('9. every entry has source metadata (organization + url)', () => {
    for (const h of HELPLINES) {
      expect(h.source.organization.length).toBeGreaterThan(0);
      expect(h.source.url).toMatch(/^https:\/\//);
    }
  });

  test('10. every entry has verification metadata', () => {
    for (const h of HELPLINES) {
      expect(h.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof h.enabled).toBe('boolean');
    }
  });

  test('11. dataset is available with no network call (plain in-memory module)', () => {
    // There is no fetch/XHR in this module at all: importing it is the only "load" step,
    // and it already happened above. getEnabledHelplines() is synchronous.
    expect(getEnabledHelplines()).toHaveLength(5);
  });

  test('only known, locked categories are used (no invented services)', () => {
    const allowed = new Set(['emergency', 'women', 'legalAid', 'cyberCrime', 'child']);
    for (const h of HELPLINES) expect(allowed.has(h.category)).toBe(true);
  });

  test('getEnabledHelplines excludes disabled entries but keeps order', () => {
    expect(getEnabledHelplines().map((h) => h.id)).toEqual(HELPLINES.map((h) => h.id));
  });

  test('15. findDialableHelpline only ever returns a bundled entry, never arbitrary input', () => {
    expect(findDialableHelpline('emergency-112')).toMatchObject({ number: '112' });
    expect(findDialableHelpline('not-a-real-id')).toBeNull();
    expect(findDialableHelpline('112')).toBeNull(); // the raw number is not an id
    expect(findDialableHelpline('')).toBeNull();
    // There is no overload, parameter, or path that accepts a caller-supplied phone number;
    // the only inputs to this module are the ids of the locked dataset above.
  });
});
