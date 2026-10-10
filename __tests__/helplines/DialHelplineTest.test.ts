import { Linking } from 'react-native';
import { dialHelpline } from '../../src/helplines/dial';
import { HELPLINES } from '../../src/helplines/domain/Helpline';

describe('dialHelpline (hands off to the system dialer; never places the call itself)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
  });

  test('14. opens tel: with the exact locked number for the given helpline', async () => {
    const res = await dialHelpline('emergency-112');
    expect(res).toEqual({ ok: true });
    expect(Linking.openURL).toHaveBeenCalledWith('tel:112');
  });

  test.each(HELPLINES.map((h) => [h.id, h.number] as const))('dials %s → tel:%s', async (id, number) => {
    await dialHelpline(id);
    expect(Linking.openURL).toHaveBeenCalledWith(`tel:${number}`);
  });

  test('an unknown/arbitrary id is rejected before any dial attempt (no fallback number)', async () => {
    const res = await dialHelpline('user-supplied-9999999999');
    expect(res).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  test('a device with no dialer reports DIALER_UNAVAILABLE instead of throwing', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    const res = await dialHelpline('emergency-112');
    expect(res).toEqual({ ok: false, reason: 'DIALER_UNAVAILABLE' });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  test('openURL rejecting is reported, not thrown', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no activity found'));
    const res = await dialHelpline('women-181');
    expect(res).toEqual({ ok: false, reason: 'DIALER_UNAVAILABLE' });
  });
});
