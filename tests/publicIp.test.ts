import { describe, expect, it, vi } from 'vitest';
import { fetchPublicIp, PUBLIC_IP_SERVICES, type FetchText } from '../src/core/publicIp';

describe('public IP (tek dış istek)', () => {
  it('tercih edilen servis önce denenir', async () => {
    const fetchText = vi.fn<FetchText>(async () => '203.0.113.5\n');
    const r = await fetchPublicIp('icanhazip', fetchText);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText.mock.calls[0][0]).toBe('https://icanhazip.com');
    expect(r).toMatchObject({ ip: '203.0.113.5', serviceId: 'icanhazip', serviceHost: 'icanhazip.com' });
  });

  it('ulaşılamazsa ya da geçersiz yanıt gelirse sonraki servise geçer', async () => {
    const fetchText = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('<html>hata</html>')
      .mockResolvedValueOnce('2001:db8::1');
    const r = await fetchPublicIp('ipify', fetchText);
    expect(fetchText).toHaveBeenCalledTimes(3);
    expect(r.ip).toBe('2001:db8::1');
  });

  it('hiçbiri yanıt vermezse hata', async () => {
    await expect(fetchPublicIp(undefined, async () => Promise.reject(new Error('offline')))).rejects.toThrow(/offline/);
  });

  it('tüm servisler HTTPS', () => {
    expect(PUBLIC_IP_SERVICES.every((s) => s.url.startsWith('https://'))).toBe(true);
  });
});
