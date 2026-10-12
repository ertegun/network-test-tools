import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { interfaceForAddress, isSplitTunnel, routeTo, sourceIpFor } from '../src/core/route';

const ifaces = {
  'Ana Ethernet': [{ address: '192.168.20.2', family: 'IPv4' }],
  'Ethernet 3': [{ address: '10.212.134.25', family: 'IPv4' }],
  lo: [
    { address: '127.0.0.1', family: 'IPv4' },
    { address: 'fe80::1%lo', family: 'IPv6' },
  ],
} as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;

describe('kaynak IP ve arayüz', () => {
  it('loopback hedefi için kaynak IP 127.0.0.1 (paket gönderilmez)', async () => {
    expect(await sourceIpFor('127.0.0.1')).toBe('127.0.0.1');
  });

  it('adresten arayüz adı', () => {
    expect(interfaceForAddress('10.212.134.25', ifaces)).toBe('Ethernet 3');
    expect(interfaceForAddress('fe80::1', ifaces)).toBe('lo');
    expect(interfaceForAddress('1.2.3.4', ifaces)).toBeUndefined();
  });

  it('routeTo hedefi çözer', async () => {
    const r = await routeTo('127.0.0.1', ifaces);
    expect(r).toMatchObject({ resolvedIp: '127.0.0.1', sourceIp: '127.0.0.1', interfaceName: 'lo' });
  });

  it('kabul kriteri: hedef arayüzü ile public IP arayüzü farklıysa uyarı', () => {
    expect(isSplitTunnel('Ana Ethernet', 'Ethernet 3')).toBe(true);
    expect(isSplitTunnel('Ethernet 3', 'Ethernet 3')).toBe(false);
    expect(isSplitTunnel(undefined, 'Ethernet 3')).toBe(false);
  });

  it('hedef bu makinenin kendisiyse (loopback) uyarı verilmez', () => {
    expect(isSplitTunnel('Loopback Pseudo-Interface 1', 'Ana Ethernet', '127.0.0.1')).toBe(false);
    expect(isSplitTunnel('lo', 'eth0', '::1')).toBe(false);
    expect(isSplitTunnel('Ana Ethernet', 'Ethernet 3', '192.168.20.1')).toBe(true);
  });
});
