// Hedefe giderken işletim sisteminin seçeceği kaynak IP ve arayüzü bulur.
// UDP soketinde connect() yalnızca yönlendirme tablosuna bakar, paket göndermez;
// böylece filtrelenmiş portlarda da kaynak IP gösterilebilir.

import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

export interface RouteInfo {
  target: string;
  resolvedIp: string;
  sourceIp: string;
  interfaceName?: string;
}

export async function resolveTarget(target: string): Promise<string> {
  if (isIP(target)) return target;
  const r = await lookup(target);
  return r.address;
}

export function sourceIpFor(ip: string): Promise<string> {
  const family = isIP(ip) === 6 ? 'udp6' : 'udp4';
  return new Promise((resolve, reject) => {
    const sock = createSocket(family);
    sock.once('error', (err) => {
      sock.close();
      reject(err);
    });
    sock.connect(9, ip, () => {
      try {
        resolve(sock.address().address);
      } catch (err) {
        reject(err);
      } finally {
        sock.close();
      }
    });
  });
}

export function interfaceForAddress(
  address: string,
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string | undefined {
  const normalized = address.replace(/%.*$/, '');
  for (const [name, infos] of Object.entries(ifaces)) {
    if (infos?.some((i) => i.address.replace(/%.*$/, '') === normalized)) return name;
  }
  return undefined;
}

export async function routeTo(
  target: string,
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): Promise<RouteInfo> {
  const resolvedIp = await resolveTarget(target);
  const sourceIp = await sourceIpFor(resolvedIp);
  return { target, resolvedIp, sourceIp, interfaceName: interfaceForAddress(sourceIp, ifaces) };
}

export function isLoopback(ip: string): boolean {
  return /^127\./.test(ip) || ip === '::1';
}

/**
 * Split-tunnel uyarısı: hedefe giden arayüz ile public IP sorgusunun gittiği
 * arayüz farklıysa true. Arayüzlerden biri bilinmiyorsa ya da hedef bu makinenin
 * kendisiyse (loopback) uyarı verilmez.
 */
export function isSplitTunnel(targetIface: string | undefined, publicIpIface: string | undefined, targetIp = ''): boolean {
  if (isLoopback(targetIp)) return false;
  return Boolean(targetIface && publicIpIface && targetIface !== publicIpIface);
}
