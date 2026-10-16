// DNS değiştirici: hazır sağlayıcı listesi ve kullanıcı kayıtlarının doğrulanması.

import type { DnsEntry } from '../shared/types';
import { isValidIPv4 } from './validate';

export const DNS_PRESETS: readonly DnsEntry[] = [
  { id: 'google', name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4', builtin: true },
  { id: 'cloudflare', name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1', builtin: true },
  { id: 'quad9', name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112', builtin: true },
  { id: 'opendns', name: 'OpenDNS', primary: '208.67.222.222', secondary: '208.67.220.220', builtin: true },
  { id: 'adguard', name: 'AdGuard', primary: '94.140.14.14', secondary: '94.140.15.15', builtin: true },
];

const MAX_NAME = 64;
const MAX_CUSTOM = 100;

const pair = (e: Pick<DnsEntry, 'primary' | 'secondary'>) => `${e.primary}|${e.secondary ?? ''}`;

/** Renderer'dan gelen kaydı temizler; hata kodları alan adıyla eşleşir (invalidName, invalidPrimary, invalidSecondary, duplicate). */
export function validateDnsEntry(raw: unknown, custom: readonly DnsEntry[]): { entry?: Omit<DnsEntry, 'id'> & { id?: string }; errors: string[] } {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const id = typeof o.id === 'string' && o.id ? o.id : undefined;
  const name = str(o.name);
  const primary = str(o.primary);
  const secondary = str(o.secondary) || undefined;
  const errors: string[] = [];
  if (!name || name.length > MAX_NAME) errors.push('invalidName');
  if (!isValidIPv4(primary)) errors.push('invalidPrimary');
  if (secondary !== undefined && (!isValidIPv4(secondary) || secondary === primary)) errors.push('invalidSecondary');
  if (errors.length === 0 && [...DNS_PRESETS, ...custom].some((e) => e.id !== id && pair(e) === pair({ primary, secondary }))) errors.push('duplicate');
  return errors.length > 0 ? { errors } : { entry: { id, name, primary, secondary }, errors };
}

/** Kaydı ekler ya da aynı kimlikli kaydı günceller. Geçersizse hata kodlarıyla Error fırlatır. */
export function saveDnsEntry(custom: readonly DnsEntry[], raw: unknown, newId: () => string): DnsEntry[] {
  const { entry, errors } = validateDnsEntry(raw, custom);
  if (!entry) throw new Error(errors.join(','));
  const existing = entry.id ? custom.find((e) => e.id === entry.id) : undefined;
  if (entry.id && !existing) throw new Error('notFound');
  if (!existing && custom.length >= MAX_CUSTOM) throw new Error('tooMany');
  const saved: DnsEntry = { id: existing?.id ?? newId(), name: entry.name, primary: entry.primary, ...(entry.secondary ? { secondary: entry.secondary } : {}) };
  return existing ? custom.map((e) => (e.id === saved.id ? saved : e)) : [...custom, saved];
}
