import {
  TrustedContact,
  activationBlockedReason,
  addBlockedReason,
  formatIndianMobile,
  normalizeIndianMobile,
  sortByPriority,
  validateContactInput,
} from '../../src/contacts/domain/TrustedContact';
import { fromContactDto, toContactWriteDto } from '../../src/contacts/api/contactsDto';
import { ContactsRepository } from '../../src/contacts/services/ContactsRepository';
import { resetIdentityForTesting } from '../../src/app/identity';
import { buildStack } from '../net/fakes';

const contact = (over: Partial<TrustedContact>): TrustedContact => ({
  id: 'c1',
  name: 'Mom',
  phone: '+919876543210',
  relationship: null,
  priority: 1,
  isActive: true,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  ...over,
});

describe('D7: Indian mobile normalization (mirrors the backend)', () => {
  test.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 9876543210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['(+91) 98765 43210', '+919876543210'],
  ])('%s → %s', (raw, normalized) => {
    expect(normalizeIndianMobile(raw)).toBe(normalized);
  });

  test.each(['12345', '+14155550100', '5876543210', '98765432101', '+91 1234567890', 'abcdefghij', ''])(
    'rejects %s',
    (raw) => expect(normalizeIndianMobile(raw)).toBeNull()
  );

  test('display format', () => {
    expect(formatIndianMobile('+919876543210')).toBe('+91 98765 43210');
  });
});

describe('contact validation and limits (D3, D7)', () => {
  test('duplicates in any format are caught before submitting; editing the same contact is fine', () => {
    const existing = [contact({ id: 'a', phone: '+919876543210' })];
    const input = { name: 'X', phone: '098765 43210', relationship: null, priority: 1, isActive: true };
    expect(validateContactInput(input, existing, null).errors.phone).toMatch(/already one of your trusted contacts/);
    expect(validateContactInput(input, existing, 'a').errors.phone).toBeUndefined();
  });

  test('name, phone and priority errors', () => {
    const { errors } = validateContactInput({ name: '  ', phone: '123', relationship: null, priority: 0, isActive: true }, [], null);
    expect(Object.keys(errors).sort()).toEqual(['name', 'phone', 'priority']);
  });

  test('10 total / 5 active limits explain themselves', () => {
    const ten = Array.from({ length: 10 }, (_, i) => contact({ id: `c${i}`, isActive: i < 5, phone: `+91987654320${i}` }));
    expect(addBlockedReason(ten)).toMatch(/at most 10 trusted contacts/);
    expect(addBlockedReason(ten.slice(0, 9))).toBeNull();
    expect(activationBlockedReason(ten, 'c7')).toMatch(/at most 5 active/);
    expect(activationBlockedReason(ten, 'c2')).toBeNull(); // already active: not blocked
  });

  test('sorted by priority then creation', () => {
    const sorted = sortByPriority([
      contact({ id: 'b', priority: 2 }),
      contact({ id: 'c', priority: 1, createdAt: '2026-10-07T00:00:02Z' }),
      contact({ id: 'a', priority: 1, createdAt: '2026-10-07T00:00:01Z' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  test('snake_case DTO mapping', () => {
    expect(
      fromContactDto({
        id: 'x', user_id: 'u', name: 'Mom', phone: '+919876543210', relationship: 'Mother',
        priority: 2, is_active: false, created_at: 'c', updated_at: 'u2',
      })
    ).toMatchObject({ id: 'x', isActive: false, relationship: 'Mother', priority: 2 });
    expect(toContactWriteDto({ isActive: true, relationship: '  ' })).toEqual({ is_active: true, relationship: null });
  });
});

describe('ContactsRepository (against the fake backend)', () => {
  beforeEach(() => resetIdentityForTesting());

  test('signed out → honest error, no request', async () => {
    const stack = buildStack();
    const repo = new ContactsRepository(stack.api);
    const res = await repo.list();
    expect(res).toEqual({ ok: false, message: 'Sign in to manage trusted contacts.', signedOut: true });
    expect(stack.backend.calls).toHaveLength(0);
  });

  test('create (normalized), list, update, server limit messages, soft delete', async () => {
    const stack = buildStack();
    await stack.auth.register('9000000001', 'secret123');
    const repo = new ContactsRepository(stack.api);

    const created = await repo.create({ name: ' Mom ', phone: '98765 43210', relationship: 'Mother', priority: 1, isActive: true });
    expect(created.ok && created.value).toMatchObject({ name: 'Mom', phone: '+919876543210', isActive: true });
    expect(stack.backend.callsTo('/contacts')[0].body).toEqual({
      name: 'Mom', phone: '98765 43210', relationship: 'Mother', priority: 1, is_active: true,
    });

    const dup = await repo.create({ name: 'Again', phone: '+919876543210', relationship: null, priority: 2, isActive: false });
    expect(dup).toEqual({ ok: false, message: 'This number is already one of your trusted contacts.', signedOut: false });

    for (let i = 1; i <= 4; i++) {
      await repo.create({ name: `C${i}`, phone: `987654321${i}`, relationship: null, priority: i, isActive: true });
    }
    const sixthActive = await repo.create({ name: 'Six', phone: '9876543299', relationship: null, priority: 6, isActive: true });
    expect(!sixthActive.ok && sixthActive.message).toMatch(/at most 5 active/);

    const list = await repo.list();
    expect(list.ok && list.value.map((c) => c.name)).toEqual(['Mom', 'C1', 'C2', 'C3', 'C4']);

    const id = created.ok ? created.value.id : '';
    const deactivated = await repo.update(id, { isActive: false });
    expect(deactivated.ok && deactivated.value.isActive).toBe(false);

    expect(await repo.remove(id)).toEqual({ ok: true, value: null });
    const after = await repo.list();
    expect(after.ok && after.value.some((c) => c.id === id)).toBe(false);
  });
});
