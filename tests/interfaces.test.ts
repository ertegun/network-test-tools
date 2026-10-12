import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildInterfaceList, classifyInterface, interfacesSignature } from '../src/core/interfaces';

const info = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false): NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: '255.255.255.0', mac: '0c:9d:92:64:1f:81', cidr: `${address}/24` }) as NetworkInterfaceInfo;

describe('arayüz sınıflandırma (M1)', () => {
  it('VPN/sanal arayüzleri ad ya da açıklamadan tanır', () => {
    expect(classifyInterface('Ethernet 3', 'Fortinet SSL VPN Virtual Ethernet Adapter')).toBe('vpn');
    expect(classifyInterface('Tailscale', 'Tailscale Tunnel')).toBe('vpn');
    expect(classifyInterface('utun3')).toBe('vpn');
    expect(classifyInterface('wg0')).toBe('vpn');
    expect(classifyInterface('tun0')).toBe('vpn');
    expect(classifyInterface('ppp0')).toBe('vpn');
    expect(classifyInterface('Ethernet 7', 'PANGP Virtual Ethernet Adapter Secure')).toBe('vpn');
  });

  it('VPN olmayanlar', () => {
    expect(classifyInterface('Ana Ethernet', 'Realtek PCIe GbE Family Controller')).toBe('ethernet');
    expect(classifyInterface('Wi-Fi', 'Intel(R) Wi-Fi 6 AX201')).toBe('wifi');
    expect(classifyInterface('wlp2s0')).toBe('wifi');
    expect(classifyInterface('enp3s0')).toBe('ethernet');
    expect(classifyInterface('lo', '', true)).toBe('loopback');
    expect(classifyInterface('Adapter', 'Generic network adapter')).toBe('other');
  });

  it('liste: VPN önce, ayrıntılar birleşir', () => {
    const list = buildInterfaceList(
      { 'Ana Ethernet': [info('192.168.20.2')], 'Ethernet 3': [info('10.212.134.25')], lo: [info('127.0.0.1', 'IPv4', true)] },
      { 'Ethernet 3': { description: 'Fortinet SSL VPN Virtual Ethernet Adapter', kind: 'ethernet' }, 'Ana Ethernet': { gateway: '192.168.20.1', dns: ['1.1.1.1'], dhcp: true } },
    );
    expect(list.map((i) => [i.name, i.kind, i.virtual])).toEqual([
      ['Ethernet 3', 'vpn', true],
      ['Ana Ethernet', 'ethernet', false],
      ['lo', 'loopback', false],
    ]);
    expect(list[1]).toMatchObject({ gateway: '192.168.20.1', dns: ['1.1.1.1'], dhcp: true, ipv4: [{ address: '192.168.20.2' }] });
  });

  it('imza adres değişince değişir (VPN bağlanma/kopma tespiti)', () => {
    const a = interfacesSignature({ eth0: [info('192.168.1.2')] });
    const b = interfacesSignature({ eth0: [info('192.168.1.2')], tun0: [info('10.8.0.2')] });
    expect(a).not.toBe(b);
    expect(interfacesSignature({ eth0: [info('192.168.1.2')] })).toBe(a);
  });
});
