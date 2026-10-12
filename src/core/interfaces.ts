// Ağ arayüzü listesi (M1). os.networkInterfaces() çıktısını platform katmanından
// gelen ayrıntılarla (tür, ağ geçidi, DNS, DHCP) birleştirir.

import type { NetworkInterfaceInfo } from 'node:os';
import type { IfaceKind, NetInterface } from '../shared/types';

export interface IfaceDetails {
  description?: string;
  kind?: IfaceKind;
  virtual?: boolean;
  up?: boolean;
  mac?: string;
  gateway?: string;
  dns?: string[];
  dhcp?: boolean;
  leaseSeconds?: number;
}

// Ad veya açıklamada geçen VPN/tünel işaretleri.
const VPN_PATTERN =
  /(^|[^a-z])(tun|tap|utun|ppp|wg|ipsec|gpd|zt|tailscale|vpn|wireguard|openvpn|anyconnect|fortinet|forticlient|globalprotect|pangp|nordlynx|proton|cloudflare warp|zerotier|juniper|pulse secure|sonicwall|checkpoint|wintun|tap-windows)/i;
const WIFI_PATTERN = /(wi-?fi|wlan|wireless|802\.11|airport|^wl)/i;
const ETHERNET_PATTERN = /(ethernet|^eth|^en[ops]|^eno|^enx|gigabit|realtek|intel\(r\) ethernet|^lan)/i;

export function classifyInterface(name: string, description = '', internal = false): IfaceKind {
  if (internal || /^lo\d*$|loopback/i.test(name)) return 'loopback';
  const text = `${name} ${description}`;
  if (VPN_PATTERN.test(text)) return 'vpn';
  if (WIFI_PATTERN.test(text)) return 'wifi';
  if (ETHERNET_PATTERN.test(text)) return 'ethernet';
  // macOS'ta en0/en1 donanım portu bilgisi gelmezse Ethernet/Wi-Fi ayırt edilemez.
  return 'other';
}

export function buildInterfaceList(
  raw: NodeJS.Dict<NetworkInterfaceInfo[]>,
  details: Record<string, IfaceDetails> = {},
): NetInterface[] {
  const list: NetInterface[] = [];
  for (const [name, infos] of Object.entries(raw)) {
    if (!infos) continue;
    const d = details[name] ?? {};
    const internal = infos.every((i) => i.internal);
    const heuristicKind = classifyInterface(name, d.description, internal);
    // Ad/açıklama VPN gösteriyorsa platformun verdiği türden önce gelir.
    const kind = heuristicKind === 'vpn' || heuristicKind === 'loopback' ? heuristicKind : d.kind ?? heuristicKind;
    const mac = d.mac ?? infos.find((i) => i.mac && i.mac !== '00:00:00:00:00:00')?.mac;
    list.push({
      name,
      description: d.description,
      kind,
      virtual: kind === 'vpn' || Boolean(d.virtual),
      up: d.up ?? true,
      mac,
      ipv4: infos.filter((i) => i.family === 'IPv4').map((i) => ({ address: i.address, netmask: i.netmask, cidr: i.cidr })),
      ipv6: infos.filter((i) => i.family === 'IPv6').map((i) => ({ address: i.address, netmask: i.netmask, cidr: i.cidr })),
      gateway: d.gateway,
      dns: d.dns ?? [],
      dhcp: d.dhcp,
      leaseSeconds: d.leaseSeconds,
    });
  }
  const order: Record<IfaceKind, number> = { vpn: 0, ethernet: 1, wifi: 2, other: 3, loopback: 4 };
  return list.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

/** Arayüz değişikliklerini hızlıca saptamak için ucuz bir imza. */
export function interfacesSignature(raw: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  return Object.entries(raw)
    .map(([name, infos]) => `${name}=${(infos ?? []).map((i) => i.address).sort().join(',')}`)
    .sort()
    .join('|');
}
