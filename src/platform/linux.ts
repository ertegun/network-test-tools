// Linux: yapılandırma yalnızca NetworkManager (nmcli) ile desteklenir.

import { readFile } from 'node:fs/promises';
import type { IfaceDetails } from '../core/interfaces';
import { normalizeMask, maskToPrefix, prefixToMask } from '../core/validate';
import type { IfaceKind, Ipv4Config } from '../shared/types';
import { run, runAll, type Runner } from './exec';
import type { Platform } from './types';

/** nmcli -t çıktısında ':' ayırıcıdır, değer içindeki ':' "\:" olarak kaçırılır. */
export function splitTerse(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) {
      cur += line[++i];
    } else if (line[i] === ':') {
      out.push(cur);
      cur = '';
    } else {
      cur += line[i];
    }
  }
  out.push(cur);
  return out;
}

export function parseNmcliDevices(out: string): Record<string, { kind?: IfaceKind; up: boolean; connection?: string }> {
  const map: Record<string, { kind?: IfaceKind; up: boolean; connection?: string }> = {};
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [dev, type, state, connection] = splitTerse(line);
    const kind: IfaceKind | undefined =
      type === 'wifi' ? 'wifi' : type === 'ethernet' ? 'ethernet' : /^(tun|wireguard|vpn|ppp)$/.test(type) ? 'vpn' : type === 'loopback' ? 'loopback' : undefined;
    map[dev] = { kind, up: state.startsWith('connected'), connection: connection && connection !== '--' ? connection : undefined };
  }
  return map;
}

/** "nmcli -t -f IP4,DHCP4 device show <dev>" çıktısı. */
export function parseDeviceShow(out: string): { gateway?: string; dns: string[]; leaseSeconds?: number } {
  const dns: string[] = [];
  let gateway: string | undefined;
  let leaseSeconds: number | undefined;
  for (const line of out.split(/\r?\n/)) {
    const [key, ...rest] = splitTerse(line);
    const value = rest.join(':');
    if (key === 'IP4.GATEWAY' && value && value !== '--') gateway = value;
    if (/^IP4\.DNS\[\d+\]$/.test(key)) dns.push(value);
    const lease = /dhcp_lease_time = (\d+)/.exec(value);
    if (key.startsWith('DHCP4.OPTION') && lease) leaseSeconds = Number(lease[1]);
  }
  return { gateway, dns, leaseSeconds };
}

/** "nmcli -t -f ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns connection show <ad>" çıktısı. */
export function parseConnectionShow(out: string): Ipv4Config {
  const fields: Record<string, string> = {};
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [key, ...rest] = splitTerse(line);
    fields[key] = rest.join(':');
  }
  const dns = (fields['ipv4.dns'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fields['ipv4.method'] !== 'manual') return { mode: 'dhcp', dns };
  const [addr] = (fields['ipv4.addresses'] ?? '').split(',');
  const [ip, prefix] = addr.trim().split('/');
  return {
    mode: 'static',
    ip,
    mask: prefixToMask(Number(prefix || 32)),
    gateway: fields['ipv4.gateway'] && fields['ipv4.gateway'] !== '--' ? fields['ipv4.gateway'] : undefined,
    dns,
  };
}

export function linuxIpv4Commands(connection: string, cfg: Ipv4Config): string[][] {
  const modify = ['nmcli', 'connection', 'modify', connection];
  if (cfg.mode === 'dhcp') {
    modify.push('ipv4.method', 'auto', 'ipv4.addresses', '', 'ipv4.gateway', '');
  } else {
    const mask = normalizeMask(cfg.mask ?? '');
    if (!cfg.ip || !mask) throw new Error('Statik ayar için IP ve maske gerekli');
    modify.push('ipv4.method', 'manual', 'ipv4.addresses', `${cfg.ip}/${maskToPrefix(mask)}`, 'ipv4.gateway', cfg.gateway ?? '');
  }
  modify.push('ipv4.dns', cfg.dns.join(','), 'ipv4.ignore-auto-dns', cfg.dns.length > 0 ? 'yes' : 'no');
  return [modify, ['nmcli', 'connection', 'up', connection]];
}

export function createLinux(runner: Runner = run): Platform {
  const hasNmcli = async () => (await runner('nmcli', ['-t', '-f', 'RUNNING', 'general'])).stdout.trim() === 'running';
  const connectionFor = async (iface: string) => {
    const r = await runner('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
    const conn = parseNmcliDevices(r.stdout)[iface]?.connection;
    if (!conn) throw new Error(`NetworkManager bağlantısı bulunamadı: ${iface}`);
    return conn;
  };
  return {
    id: 'linux',
    hostsPath: () => '/etc/hosts',
    interfaceDetails: async () => {
      const out: Record<string, IfaceDetails> = {};
      if (await hasNmcli()) {
        const devs = parseNmcliDevices((await runner('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device'])).stdout);
        await Promise.all(
          Object.entries(devs).map(async ([dev, info]) => {
            const show = parseDeviceShow((await runner('nmcli', ['-t', '-f', 'IP4,DHCP4', 'device', 'show', dev])).stdout);
            out[dev] = { kind: info.kind, up: info.up, gateway: show.gateway, dns: show.dns, leaseSeconds: show.leaseSeconds, dhcp: show.leaseSeconds !== undefined };
          }),
        );
        return out;
      }
      // NetworkManager yoksa yalnızca okuma: varsayılan rota ve resolv.conf.
      const routes = await runner('ip', ['-4', 'route', 'show', 'default']);
      for (const m of routes.stdout.matchAll(/default via (\S+) dev (\S+)/g)) (out[m[2]] ??= {}).gateway ??= m[1];
      const resolv = await readFile('/etc/resolv.conf', 'utf8').catch(() => '');
      const dns = [...resolv.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]);
      for (const d of Object.values(out)) d.dns = dns;
      return out;
    },
    configSupport: async () => ((await hasNmcli()) ? { supported: true } : { supported: false, reason: 'networkManagerMissing' }),
    readIpv4Config: async (iface) => {
      const conn = await connectionFor(iface);
      const r = await runner('nmcli', ['-t', '-f', 'ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns', 'connection', 'show', conn]);
      if (r.code !== 0) throw new Error(`Bağlantı okunamadı: ${conn}`);
      return parseConnectionShow(r.stdout);
    },
    ping: async (ip, timeoutMs) =>
      (await runner('ping', ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip], { timeoutMs: timeoutMs + 3000 })).code === 0,
    applyIpv4: async (iface, cfg) => runAll(runner, linuxIpv4Commands(await connectionFor(iface), cfg), { timeoutMs: 30_000 }),
    flushDns: async () => {
      // systemd-resolved yoksa önbellek de yoktur; hata yok sayılır.
      const r = await runner('resolvectl', ['flush-caches']);
      if (r.code !== 0) await runner('systemd-resolve', ['--flush-caches']);
    },
  };
}
