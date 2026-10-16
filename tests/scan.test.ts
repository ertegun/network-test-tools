import { createServer } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { probePort } from '../src/core/portScan';
import { portsFor, scanRoute } from '../src/main/scan';

describe('portsFor', () => {
  it('top100 → 100 port, all → 1-65535 benzersiz ve sıralı', () => {
    expect(portsFor({ target: 'x', preset: 'top100' })).toHaveLength(100);
    const all = portsFor({ target: 'x', preset: 'all' });
    expect(all).toHaveLength(65535);
    expect(new Set(all).size).toBe(65535);
    expect(all[0]).toBe(1);
    expect(all[65534]).toBe(65535);
  });

  it('hazır listede metin girişi doğrulanmaz, özel listede geçersiz giriş reddedilir', () => {
    expect(portsFor({ target: 'x', preset: 'all', ports: 'abc' })).toHaveLength(65535);
    expect(portsFor({ target: 'x', preset: 'top100', ports: '70000' })).toHaveLength(100);
    expect(() => portsFor({ target: 'x', ports: 'abc' })).toThrow();
    expect(() => portsFor({ target: 'x', ports: '70000' })).toThrow();
  });
});

describe('scanRoute (yol ve kaynak IP)', () => {
  const v4 = (address: string) => ({ address, family: 'IPv4' }) as NetworkInterfaceInfo;
  const ifaces = { Ethernet: [v4('192.168.1.10'), { address: 'fe80::1', family: 'IPv6' } as NetworkInterfaceInfo], lo: [v4('127.0.0.1')] };

  it('varsayılan doğrudan; arayüzdeki IPv4 kabul edilir ve arayüz adı döner', () => {
    expect(scanRoute({ target: 'x' }, ifaces)).toEqual({ path: 'direct' });
    expect(scanRoute({ target: 'x', path: 'tor' }, ifaces)).toEqual({ path: 'tor' });
    expect(scanRoute({ target: 'x', path: 'direct', sourceIp: '192.168.1.10' }, ifaces)).toEqual({ path: 'direct', sourceIp: '192.168.1.10', interfaceName: 'Ethernet' });
  });

  it('arayüzde olmayan IP, IPv6, Tor ile kaynak IP ve bilinmeyen yol reddedilir', () => {
    expect(() => scanRoute({ target: 'x', sourceIp: '10.0.0.99' }, ifaces)).toThrow('invalidSourceIp');
    expect(() => scanRoute({ target: 'x', sourceIp: 'fe80::1' }, ifaces)).toThrow('invalidSourceIp');
    expect(() => scanRoute({ target: 'x', sourceIp: 'abc' }, ifaces)).toThrow('invalidSourceIp');
    expect(() => scanRoute({ target: 'x', path: 'tor', sourceIp: '192.168.1.10' }, ifaces)).toThrow('invalidSourceIp');
    expect(() => scanRoute({ target: 'x', path: 'cloudflare' as never }, ifaces)).toThrow('invalidPath');
  });

  it('bağlantı seçilen kaynak IP adresinden çıkar', async () => {
    let seen: string | undefined;
    const server = createServer((s) => {
      seen = s.remoteAddress;
      s.destroy();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await probePort('127.0.0.1', (server.address() as { port: number }).port, 1000, undefined, '127.0.0.1');
    await new Promise((res) => server.close(res));
    expect(r.state).toBe('open');
    expect(seen).toBe('127.0.0.1');
  });
});
