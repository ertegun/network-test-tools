// Girdi doğrulama yardımcıları. Hem arayüz tarafı (main) hem yetkili yardımcı
// aynı fonksiyonları kullanır; kullanıcı girdisi asla kabuğa verilmez.

import { isIPv6 } from 'node:net';

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function isValidIPv4(value: string): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => IPV4_OCTET.test(p));
}

export function isValidIPv6(value: string): boolean {
  // Kapsam (fe80::1%eth0) desteklenmez; yalnızca adres.
  return typeof value === 'string' && !value.includes('%') && isIPv6(value);
}

export function isValidIP(value: string): boolean {
  return isValidIPv4(value) || isValidIPv6(value);
}

export function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

export function intToIPv4(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function isValidSubnetMask(mask: string): boolean {
  if (!isValidIPv4(mask)) return false;
  const n = ipv4ToInt(mask);
  if (n === 0) return false;
  // Maske soldan bitişik 1'lerden oluşmalı.
  const inverted = ~n >>> 0;
  return (inverted & (inverted + 1)) === 0;
}

export function maskToPrefix(mask: string): number {
  return ipv4ToInt(mask).toString(2).replace(/0/g, '').length;
}

export function prefixToMask(prefix: number): string {
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) throw new Error(`Geçersiz önek: ${prefix}`);
  return intToIPv4(prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0);
}

/** "255.255.255.0" veya "/24" / "24" kabul eder, maske döndürür; geçersizse null. */
export function normalizeMask(input: string): string | null {
  const trimmed = input.trim();
  const m = /^\/?(\d{1,2})$/.exec(trimmed);
  if (m) {
    const prefix = Number(m[1]);
    return prefix >= 1 && prefix <= 32 ? prefixToMask(prefix) : null;
  }
  return isValidSubnetMask(trimmed) ? trimmed : null;
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  const m = ipv4ToInt(mask);
  return (ipv4ToInt(a) & m) === (ipv4ToInt(b) & m);
}

// RFC 1123 ana bilgisayar adı. Hosts kayıtları ve hedefler için kullanılır.
const HOST_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;

export function isValidHostname(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  const name = value.endsWith('.') ? value.slice(0, -1) : value;
  if (name.length === 0) return false;
  return name.split('.').every((label) => HOST_LABEL.test(label));
}

export function isValidTarget(value: string): boolean {
  return isValidIP(value) || isValidHostname(value);
}

// Arayüz adları OS'e göre değişir ("Ethernet 2", "en0", "Wi-Fi (Intel)").
// Komutlara ayrı argüman olarak verilir; yine de kontrol karakteri, tırnak ve
// seçenek gibi görünen ('-' ile başlayan) adlar reddedilir.
export function isValidInterfaceName(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > 64) return false;
  if (value.startsWith('-') || value !== value.trim()) return false;
  return /^[\p{L}\p{N} ._()#:+-]+$/u.test(value);
}

export interface Ipv4StaticConfig {
  ip?: string;
  mask?: string;
  gateway?: string;
  dns: string[];
}

export type ValidationError =
  | 'invalidIp'
  | 'invalidMask'
  | 'invalidGateway'
  | 'gatewayOutsideSubnet'
  | 'invalidDns'
  | 'networkOrBroadcast'
  | 'tooManyDns';

/** Statik IPv4 yapılandırmasını doğrular; hata kodlarını döndürür (boş = geçerli). */
export function validateStaticConfig(cfg: Ipv4StaticConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isValidIPv4(cfg.ip ?? '')) errors.push('invalidIp');
  const mask = normalizeMask(cfg.mask ?? '');
  if (!mask) errors.push('invalidMask');
  if (cfg.gateway !== undefined && cfg.gateway !== '' && !isValidIPv4(cfg.gateway)) errors.push('invalidGateway');
  if (!Array.isArray(cfg.dns) || cfg.dns.some((d) => !isValidIP(d))) errors.push('invalidDns');
  if (Array.isArray(cfg.dns) && cfg.dns.length > 4) errors.push('tooManyDns');
  if (errors.length === 0 && mask && cfg.ip) {
    const ipStr = cfg.ip;
    const prefix = maskToPrefix(mask);
    if (prefix <= 30) {
      const m = ipv4ToInt(mask);
      const ip = ipv4ToInt(ipStr);
      const network = ip & m;
      const broadcast = (network | (~m >>> 0)) >>> 0;
      if (ip === network >>> 0 || ip === broadcast) errors.push('networkOrBroadcast');
    }
    if (cfg.gateway && !sameSubnet(ipStr, cfg.gateway, mask)) errors.push('gatewayOutsideSubnet');
  }
  return errors;
}
