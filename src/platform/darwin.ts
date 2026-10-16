// macOS: bilgi networksetup/netstat/scutil/ipconfig ile okunur, değişiklik networksetup ile yapılır.

import type { IfaceDetails } from '../core/interfaces';
import { isValidIPv4 } from '../core/validate';
import type { Ipv4Config } from '../shared/types';
import { run, runAll, type Runner } from './exec';
import type { Platform } from './types';

/** "Hardware Port: Wi-Fi\nDevice: en0" bloklarından aygıt → servis adı eşlemesi. */
export function parseHardwarePorts(out: string): Record<string, string> {
  const map: Record<string, string> = {};
  let port: string | undefined;
  for (const line of out.split(/\r?\n/)) {
    const p = /^Hardware Port:\s*(.+)$/.exec(line);
    if (p) port = p[1].trim();
    const d = /^Device:\s*(\S+)/.exec(line);
    if (d && port) map[d[1]] = port;
  }
  return map;
}

/** netstat -rn -f inet çıktısından arayüz başına varsayılan ağ geçidi. */
export function parseDefaultRoutes(out: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== 'default' || !isValidIPv4(cols[1])) continue;
    const iface = cols[3];
    if (iface && !map[iface]) map[iface] = cols[1];
  }
  return map;
}

/** scutil --dns çıktısındaki ilk çözümleyicinin ad sunucuları. */
export function parseScutilDns(out: string): string[] {
  const servers: string[] = [];
  for (const block of out.split(/\nresolver #/)) {
    const ns = [...block.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]);
    if (ns.length > 0) {
      servers.push(...ns);
      break;
    }
  }
  return servers;
}

/** networksetup -getinfo <servis> çıktısı. */
export function parseGetInfo(out: string): { dhcp: boolean; ip?: string; mask?: string; gateway?: string } {
  const field = (name: string) => new RegExp(`^${name}:\\s*(\\S+)`, 'm').exec(out)?.[1];
  const router = field('Router');
  return {
    dhcp: /^DHCP Configuration/m.test(out),
    ip: field('IP address'),
    mask: field('Subnet mask'),
    gateway: router && isValidIPv4(router) ? router : undefined,
  };
}

export function parseDnsServers(out: string): string[] {
  if (/aren't any DNS Servers/i.test(out)) return [];
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

export function darwinIpv4Commands(service: string, cfg: Ipv4Config): string[][] {
  const cmds: string[][] = [];
  if (cfg.mode === 'dhcp') {
    cmds.push(['networksetup', '-setdhcp', service]);
  } else {
    if (!cfg.ip || !cfg.mask) throw new Error('Statik ayar için IP ve maske gerekli');
    const cmd = ['networksetup', '-setmanual', service, cfg.ip, cfg.mask];
    if (cfg.gateway) cmd.push(cfg.gateway);
    cmds.push(cmd);
  }
  return [...cmds, ...darwinDnsCommands(service, cfg.dns)];
}

/** Yalnızca DNS sunucuları; boş liste ("Empty") DNS'i DHCP'ye döndürür. */
export function darwinDnsCommands(service: string, dns: string[]): string[][] {
  return [['networksetup', '-setdnsservers', service, ...(dns.length > 0 ? dns : ['Empty'])]];
}

export function createDarwin(runner: Runner = run): Platform {
  const serviceFor = async (iface: string) => {
    const r = await runner('networksetup', ['-listallhardwareports']);
    const service = parseHardwarePorts(r.stdout)[iface];
    if (!service) throw new Error(`Ağ servisi bulunamadı: ${iface}`);
    return service;
  };
  return {
    id: 'darwin',
    hostsPath: () => '/etc/hosts',
    interfaceDetails: async () => {
      const [ports, routes, dns] = await Promise.all([
        runner('networksetup', ['-listallhardwareports']),
        runner('netstat', ['-rn', '-f', 'inet']),
        runner('scutil', ['--dns']),
      ]);
      const hw = parseHardwarePorts(ports.stdout);
      const gw = parseDefaultRoutes(routes.stdout);
      const servers = parseScutilDns(dns.stdout);
      const out: Record<string, IfaceDetails> = {};
      for (const [dev, port] of Object.entries(hw)) {
        out[dev] = {
          description: port,
          kind: /wi-?fi|airport/i.test(port) ? 'wifi' : /ethernet|thunderbolt|usb.*lan/i.test(port) ? 'ethernet' : undefined,
        };
      }
      for (const [dev, g] of Object.entries(gw)) (out[dev] ??= {}).gateway = g;
      // macOS DNS'i sistem geneli çözer; birincil (ağ geçidi olan) arayüzlere atanır.
      for (const dev of Object.keys(gw)) out[dev].dns = servers;
      await Promise.all(
        Object.keys(out).map(async (dev) => {
          const r = await runner('ipconfig', ['getpacket', dev], { timeoutMs: 3000 });
          if (r.code !== 0) return;
          out[dev].dhcp = true;
          const lease = /lease_time \(uint32\): 0x([0-9a-f]+)/i.exec(r.stdout);
          if (lease) out[dev].leaseSeconds = parseInt(lease[1], 16);
        }),
      );
      return out;
    },
    configSupport: async () => ({ supported: true }),
    readIpv4Config: async (iface) => {
      const service = await serviceFor(iface);
      const [info, dns] = await Promise.all([runner('networksetup', ['-getinfo', service]), runner('networksetup', ['-getdnsservers', service])]);
      const i = parseGetInfo(info.stdout);
      const servers = parseDnsServers(dns.stdout);
      if (i.dhcp) return { mode: 'dhcp', dns: servers };
      if (!i.ip || !i.mask) throw new Error(`IPv4 ayarı okunamadı: ${iface}`);
      return { mode: 'static', ip: i.ip, mask: i.mask, gateway: i.gateway, dns: servers };
    },
    ping: async (ip, timeoutMs) => (await runner('ping', ['-c', '1', '-W', String(timeoutMs), ip], { timeoutMs: timeoutMs + 3000 })).code === 0,
    applyIpv4: async (iface, cfg) => runAll(runner, darwinIpv4Commands(await serviceFor(iface), cfg), { timeoutMs: 30_000 }),
    applyDns: async (iface, dns) => runAll(runner, darwinDnsCommands(await serviceFor(iface), dns), { timeoutMs: 30_000 }),
    flushDns: () => runAll(runner, [['dscacheutil', '-flushcache'], ['killall', '-HUP', 'mDNSResponder']]),
  };
}
