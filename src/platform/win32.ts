// Windows: bilgi PowerShell (Get-Net*) ile okunur, değişiklik netsh ile yapılır.

import { join } from 'node:path';
import type { IfaceDetails } from '../core/interfaces';
import { normalizeMask, prefixToMask } from '../core/validate';
import type { Ipv4Config } from '../shared/types';
import { run, runAll, type Runner } from './exec';
import type { Platform } from './types';

// Sabit betik: kullanıcı girdisi içermez.
const DETAILS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$adapters = @(Get-NetAdapter | ForEach-Object {
  $ns = (Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $_.InterfaceGuid)).NameServer
  [pscustomobject]@{ Name = $_.Name; Description = $_.InterfaceDescription; Status = [string]$_.Status; Mac = $_.MacAddress; Virtual = [bool]$_.Virtual; Media = [string]$_.PhysicalMediaType; NdisMedium = [string]$_.NdisPhysicalMedium; StaticDns = [string]$ns }
})
$routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object InterfaceAlias, NextHop)
$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, @{n='Servers';e={[string]::Join(',', $_.ServerAddresses)}})
$ipif = @(Get-NetIPInterface -AddressFamily IPv4 | Select-Object InterfaceAlias, @{n='Dhcp';e={[int]$_.Dhcp}})
$addr = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress, PrefixLength, @{n='Origin';e={[int]$_.PrefixOrigin}}, @{n='Lease';e={[int64]$_.ValidLifetime.TotalSeconds}})
[pscustomobject]@{ adapters = $adapters; routes = $routes; dns = $dns; ipif = $ipif; addr = $addr } | ConvertTo-Json -Depth 5 -Compress
`;

interface WinDetails {
  adapters: { Name: string; Description: string; Status: string; Mac: string; Virtual: boolean; Media: string; NdisMedium: string; StaticDns: string }[];
  routes: { InterfaceAlias: string; NextHop: string }[];
  dns: { InterfaceAlias: string; Servers: string | null }[];
  ipif: { InterfaceAlias: string; Dhcp: number }[];
  addr: { InterfaceAlias: string; IPAddress: string; PrefixLength: number; Origin: number; Lease: number }[];
}

// ValidLifetime "sonsuz" değeri ~922337203685 sn olarak gelir.
const INFINITE_LEASE = 10 * 365 * 24 * 3600;

export function parseWinDetails(json: string): Record<string, IfaceDetails & { staticDns?: string[]; prefix?: number; ip?: string }> {
  const data = JSON.parse(json) as WinDetails;
  const arr = <T>(v: T[] | T | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const out: Record<string, IfaceDetails & { staticDns?: string[]; prefix?: number; ip?: string }> = {};
  for (const a of arr(data.adapters)) {
    const wifi = /802\.11|wireless|native 802/i.test(`${a.Media} ${a.NdisMedium}`);
    out[a.Name] = {
      description: a.Description,
      kind: wifi ? 'wifi' : /802\.3/.test(a.Media) ? 'ethernet' : undefined,
      virtual: a.Virtual,
      up: a.Status === 'Up',
      mac: a.Mac ? a.Mac.replace(/-/g, ':').toLowerCase() : undefined,
      staticDns: a.StaticDns ? a.StaticDns.split(/[,\s]+/).filter(Boolean) : [],
    };
  }
  for (const r of arr(data.routes)) {
    const d = (out[r.InterfaceAlias] ??= {});
    // Rotalar metriğe göre sıralı gelir; ilk geçerli ağ geçidi tutulur.
    if (!d.gateway && r.NextHop && r.NextHop !== '0.0.0.0') d.gateway = r.NextHop;
  }
  for (const n of arr(data.dns)) {
    const d = (out[n.InterfaceAlias] ??= {});
    // PowerShell 5.1 hesaplanmış özellikteki dizileri {value, Count} nesnesine çevirir; bu yüzden virgüllü metin.
    d.dns = (n.Servers ?? '').split(',').filter(Boolean);
  }
  for (const i of arr(data.ipif)) {
    const d = (out[i.InterfaceAlias] ??= {});
    d.dhcp = i.Dhcp === 1;
  }
  for (const a of arr(data.addr)) {
    const d = (out[a.InterfaceAlias] ??= {});
    if (d.ip) continue;
    d.ip = a.IPAddress;
    d.prefix = a.PrefixLength;
    // PrefixOrigin 3 = Dhcp
    if (a.Origin === 3 && a.Lease > 0 && a.Lease < INFINITE_LEASE) d.leaseSeconds = a.Lease;
  }
  return out;
}

export function win32Ipv4Commands(iface: string, cfg: Ipv4Config): string[][] {
  const cmds: string[][] = [];
  if (cfg.mode === 'dhcp') {
    cmds.push(['netsh', 'interface', 'ipv4', 'set', 'address', iface, 'dhcp']);
  } else {
    const mask = normalizeMask(cfg.mask ?? '');
    if (!cfg.ip || !mask) throw new Error('Statik ayar için IP ve maske gerekli');
    const cmd = ['netsh', 'interface', 'ipv4', 'set', 'address', iface, 'static', cfg.ip, mask];
    if (cfg.gateway) cmd.push(cfg.gateway);
    cmds.push(cmd);
  }
  if (cfg.dns.length === 0) {
    cmds.push(['netsh', 'interface', 'ipv4', 'set', 'dnsservers', iface, 'dhcp']);
  } else {
    cmds.push(['netsh', 'interface', 'ipv4', 'set', 'dnsservers', iface, 'static', cfg.dns[0], 'primary', 'validate=no']);
    cfg.dns.slice(1).forEach((d, i) => cmds.push(['netsh', 'interface', 'ipv4', 'add', 'dnsservers', iface, d, `index=${i + 2}`, 'validate=no']));
  }
  return cmds;
}

export function createWin32(runner: Runner = run): Platform {
  const details = async () => {
    const r = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DETAILS_SCRIPT], { timeoutMs: 20_000 });
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(`Get-NetAdapter başarısız: ${r.stderr.trim()}`);
    return parseWinDetails(r.stdout);
  };
  return {
    id: 'win32',
    hostsPath: () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts'),
    interfaceDetails: async () => {
      try {
        return await details();
      } catch {
        return {};
      }
    },
    configSupport: async () => ({ supported: true }),
    readIpv4Config: async (iface) => {
      const d = (await details())[iface];
      if (!d) throw new Error(`Arayüz bulunamadı: ${iface}`);
      if (d.dhcp) return { mode: 'dhcp', dns: d.staticDns ?? [] };
      if (!d.ip || d.prefix === undefined) throw new Error(`IPv4 adresi okunamadı: ${iface}`);
      return { mode: 'static', ip: d.ip, mask: prefixToMask(d.prefix), gateway: d.gateway, dns: d.staticDns ?? [] };
    },
    ping: async (ip, timeoutMs) => {
      const r = await runner('ping', ['-n', '1', '-w', String(timeoutMs), ip], { timeoutMs: timeoutMs + 3000 });
      // "Hedef ana bilgisayara ulaşılamıyor" yanıtında da çıkış kodu 0 olabilir; TTL aranır.
      return r.code === 0 && /TTL=/i.test(r.stdout);
    },
    applyIpv4: (iface, cfg) => runAll(runner, win32Ipv4Commands(iface, cfg), { timeoutMs: 30_000 }),
    flushDns: () => runAll(runner, [['ipconfig', '/flushdns']]),
  };
}
