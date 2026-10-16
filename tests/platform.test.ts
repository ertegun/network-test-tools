import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { darwinDnsCommands, darwinIpv4Commands, parseDefaultRoutes, parseDnsServers, parseGetInfo, parseHardwarePorts, parseScutilDns } from '../src/platform/darwin';
import type { Runner } from '../src/platform/exec';
import { createLinux, linuxDnsCommands, linuxIpv4Commands, parseConnectionShow, parseDeviceShow, parseNmcliDevices, splitTerse } from '../src/platform/linux';
import { createWin32, parseWinDetails, win32DnsCommands, win32Ipv4Commands } from '../src/platform/win32';

const WIN_JSON = readFileSync(join(__dirname, 'fixtures', 'win-details.json'), 'utf8');

describe('Windows', () => {
  it('Get-Net* çıktısını ayrıştırır', () => {
    const d = parseWinDetails(WIN_JSON);
    expect(d['Ana Ethernet']).toMatchObject({ kind: 'ethernet', up: true, gateway: '192.168.20.1', dns: ['192.168.20.1'], dhcp: true, leaseSeconds: 1454, mac: '0c:9d:92:64:1f:81' });
    // Sonsuz kira süresi ve 0.0.0.0 ağ geçidi yok sayılır.
    expect(d['Ethernet 3']).toMatchObject({ description: 'Fortinet SSL VPN Virtual Ethernet Adapter', virtual: true, dhcp: false, staticDns: ['10.100.8.111', '10.100.8.110'] });
    expect(d['Ethernet 3'].gateway).toBeUndefined();
    expect(d['Ethernet 3'].leaseSeconds).toBeUndefined();
    expect(d['Wi-Fi']).toMatchObject({ kind: 'wifi', up: false, dns: [] });
  });

  it('netsh komutları: her değer ayrı argüman (kabuk yok)', () => {
    expect(win32Ipv4Commands('Ethernet 2', { mode: 'static', ip: '192.168.1.10', mask: '/24', gateway: '192.168.1.1', dns: ['1.1.1.1', '8.8.8.8'] })).toEqual([
      ['netsh', 'interface', 'ipv4', 'set', 'address', 'Ethernet 2', 'static', '192.168.1.10', '255.255.255.0', '192.168.1.1'],
      ['netsh', 'interface', 'ipv4', 'set', 'dnsservers', 'Ethernet 2', 'static', '1.1.1.1', 'primary', 'validate=no'],
      ['netsh', 'interface', 'ipv4', 'add', 'dnsservers', 'Ethernet 2', '8.8.8.8', 'index=2', 'validate=no'],
    ]);
    expect(win32Ipv4Commands('Wi-Fi', { mode: 'dhcp', dns: [] })).toEqual([
      ['netsh', 'interface', 'ipv4', 'set', 'address', 'Wi-Fi', 'dhcp'],
      ['netsh', 'interface', 'ipv4', 'set', 'dnsservers', 'Wi-Fi', 'dhcp'],
    ]);
  });

  it('readIpv4Config statik ayarı ve statik DNS listesini döndürür', async () => {
    const runner: Runner = vi.fn(async () => ({ stdout: WIN_JSON, stderr: '', code: 0 }));
    const p = createWin32(runner);
    expect(await p.readIpv4Config('Ethernet 3')).toEqual({ mode: 'static', ip: '10.212.134.25', mask: '255.255.255.255', gateway: undefined, dns: ['10.100.8.111', '10.100.8.110'] });
    expect(await p.readIpv4Config('Ana Ethernet')).toEqual({ mode: 'dhcp', dns: [] });
    await expect(p.readIpv4Config('Yok')).rejects.toThrow();
  });

  it('ping yanıtında TTL arar', async () => {
    const reply = createWin32(async () => ({ stdout: 'Reply from 1.1.1.1: bytes=32 time=5ms TTL=57', stderr: '', code: 0 }));
    const unreachable = createWin32(async () => ({ stdout: 'Reply from 192.168.1.2: Destination host unreachable.', stderr: '', code: 0 }));
    expect(await reply.ping('1.1.1.1', 1000)).toBe(true);
    expect(await unreachable.ping('192.168.1.50', 1000)).toBe(false);
  });
});

describe('macOS', () => {
  it('donanım portları, rotalar ve DNS', () => {
    expect(parseHardwarePorts('Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa\n\nHardware Port: Thunderbolt Ethernet\nDevice: en5\n')).toEqual({ en0: 'Wi-Fi', en5: 'Thunderbolt Ethernet' });
    expect(parseDefaultRoutes('Routing tables\n\nInternet:\nDestination Gateway Flags Netif Expire\ndefault 192.168.1.1 UGScg en0\ndefault link#17 UCSIg utun3\n')).toEqual({ en0: '192.168.1.1' });
    expect(parseScutilDns('DNS configuration\n\nresolver #1\n  nameserver[0] : 1.1.1.1\n  nameserver[1] : 8.8.8.8\n\nresolver #2\n  nameserver[0] : 9.9.9.9\n')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(parseDnsServers("There aren't any DNS Servers set on Wi-Fi.\n")).toEqual([]);
    expect(parseDnsServers('1.1.1.1\n8.8.8.8\n')).toEqual(['1.1.1.1', '8.8.8.8']);
  });

  it('networksetup -getinfo', () => {
    expect(parseGetInfo('DHCP Configuration\nIP address: 192.168.1.20\nSubnet mask: 255.255.255.0\nRouter: 192.168.1.1\n')).toEqual({ dhcp: true, ip: '192.168.1.20', mask: '255.255.255.0', gateway: '192.168.1.1' });
    expect(parseGetInfo('Manual Configuration\nIP address: 10.0.0.2\nSubnet mask: 255.0.0.0\nRouter: (null)\n')).toMatchObject({ dhcp: false, gateway: undefined });
  });

  it('networksetup komutları', () => {
    expect(darwinIpv4Commands('Wi-Fi', { mode: 'static', ip: '10.0.0.2', mask: '255.0.0.0', gateway: '10.0.0.1', dns: [] })).toEqual([
      ['networksetup', '-setmanual', 'Wi-Fi', '10.0.0.2', '255.0.0.0', '10.0.0.1'],
      ['networksetup', '-setdnsservers', 'Wi-Fi', 'Empty'],
    ]);
    expect(darwinIpv4Commands('Wi-Fi', { mode: 'dhcp', dns: ['1.1.1.1'] })).toEqual([
      ['networksetup', '-setdhcp', 'Wi-Fi'],
      ['networksetup', '-setdnsservers', 'Wi-Fi', '1.1.1.1'],
    ]);
  });
});

describe('Linux (NetworkManager)', () => {
  it('nmcli kaçışlı alanlar', () => {
    expect(splitTerse('eth0:ethernet:connected:Kablolu bağlantı 1')).toEqual(['eth0', 'ethernet', 'connected', 'Kablolu bağlantı 1']);
    expect(splitTerse('IP6.ADDRESS[1]:fe80\\:\\:1/64')).toEqual(['IP6.ADDRESS[1]', 'fe80::1/64']);
  });

  it('aygıtlar, aygıt ayrıntısı ve bağlantı', () => {
    expect(parseNmcliDevices('eth0:ethernet:connected:Wired\nwlan0:wifi:disconnected:--\ntun0:tun:connected (externally):tun0\n')).toEqual({
      eth0: { kind: 'ethernet', up: true, connection: 'Wired' },
      wlan0: { kind: 'wifi', up: false, connection: undefined },
      tun0: { kind: 'vpn', up: true, connection: 'tun0' },
    });
    expect(parseDeviceShow('IP4.ADDRESS[1]:192.168.1.5/24\nIP4.GATEWAY:192.168.1.1\nIP4.DNS[1]:1.1.1.1\nIP4.DNS[2]:8.8.8.8\nDHCP4.OPTION[3]:dhcp_lease_time = 86400\n')).toEqual({
      gateway: '192.168.1.1',
      dns: ['1.1.1.1', '8.8.8.8'],
      leaseSeconds: 86400,
    });
    expect(parseConnectionShow('ipv4.method:manual\nipv4.addresses:10.0.0.5/24\nipv4.gateway:10.0.0.1\nipv4.dns:1.1.1.1,9.9.9.9\n')).toEqual({
      mode: 'static',
      ip: '10.0.0.5',
      mask: '255.255.255.0',
      gateway: '10.0.0.1',
      dns: ['1.1.1.1', '9.9.9.9'],
    });
    expect(parseConnectionShow('ipv4.method:auto\nipv4.addresses:\nipv4.gateway:--\nipv4.dns:\n')).toEqual({ mode: 'dhcp', dns: [] });
  });

  it('nmcli komutları', () => {
    expect(linuxIpv4Commands('Wired', { mode: 'static', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '10.0.0.1', dns: ['1.1.1.1'] })).toEqual([
      ['nmcli', 'connection', 'modify', 'Wired', 'ipv4.method', 'manual', 'ipv4.addresses', '10.0.0.5/24', 'ipv4.gateway', '10.0.0.1', 'ipv4.dns', '1.1.1.1', 'ipv4.ignore-auto-dns', 'yes'],
      ['nmcli', 'connection', 'up', 'Wired'],
    ]);
    expect(linuxIpv4Commands('Wired', { mode: 'dhcp', dns: [] })[0]).toEqual([
      'nmcli', 'connection', 'modify', 'Wired', 'ipv4.method', 'auto', 'ipv4.addresses', '', 'ipv4.gateway', '', 'ipv4.dns', '', 'ipv4.ignore-auto-dns', 'no',
    ]);
  });

  it('NetworkManager yoksa yapılandırma devre dışı ve nedeni bildirilir', async () => {
    const p = createLinux(async () => ({ stdout: '', stderr: 'nmcli: not found', code: 127 }));
    expect(await p.configSupport()).toEqual({ supported: false, reason: 'networkManagerMissing' });
  });
});

describe('yalnızca DNS komutları (DNS değiştirici)', () => {
  it("adres ayarına dokunmaz; boş liste DNS'i DHCP'ye döndürür", () => {
    expect(win32DnsCommands('Wi-Fi', ['1.1.1.1', '1.0.0.1'])).toEqual([
      ['netsh', 'interface', 'ipv4', 'set', 'dnsservers', 'Wi-Fi', 'static', '1.1.1.1', 'primary', 'validate=no'],
      ['netsh', 'interface', 'ipv4', 'add', 'dnsservers', 'Wi-Fi', '1.0.0.1', 'index=2', 'validate=no'],
    ]);
    expect(win32DnsCommands('Wi-Fi', [])).toEqual([['netsh', 'interface', 'ipv4', 'set', 'dnsservers', 'Wi-Fi', 'dhcp']]);
    expect(darwinDnsCommands('Wi-Fi', ['9.9.9.9'])).toEqual([['networksetup', '-setdnsservers', 'Wi-Fi', '9.9.9.9']]);
    expect(darwinDnsCommands('Wi-Fi', [])).toEqual([['networksetup', '-setdnsservers', 'Wi-Fi', 'Empty']]);
    expect(linuxDnsCommands('Wired', ['1.1.1.1', '1.0.0.1'])).toEqual([
      ['nmcli', 'connection', 'modify', 'Wired', 'ipv4.dns', '1.1.1.1,1.0.0.1', 'ipv4.ignore-auto-dns', 'yes'],
      ['nmcli', 'connection', 'up', 'Wired'],
    ]);
    expect(linuxDnsCommands('Wired', [])[0]).toEqual(['nmcli', 'connection', 'modify', 'Wired', 'ipv4.dns', '', 'ipv4.ignore-auto-dns', 'no']);
  });
});
