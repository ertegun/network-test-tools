// Hosts dosyası yönetimi (M8). Uygulama yalnızca kendi işaretli bloğunu yazar;
// blok dışındaki baytlar olduğu gibi korunur (satır sonları dahil).

import type { HostsConflict, HostsEntry, HostsGroup } from '../shared/types';
import { isValidHostname, isValidIP } from './validate';

export const BLOCK_BEGIN = '# --- NetKit BEGIN (bu bloğu elle düzenlemeyin) ---';
export const BLOCK_END = '# --- NetKit END ---';
// İşaret satırları önek ile tanınır; açıklama metni değişse de blok bulunur.
const BEGIN_PREFIX = '# --- NetKit BEGIN';
const END_PREFIX = '# --- NetKit END';

export const MAX_HOSTS_FILE_BYTES = 4 * 1024 * 1024;

interface BlockLocation {
  /** Bloğun ilk karakterinin indeksi (BEGIN satırının başı). */
  start: number;
  /** Bloğun bittiği indeks (END satırının satır sonu dahil). */
  end: number;
}

export function detectEol(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function lineStartsAt(content: string, prefix: string, from = 0): number {
  let idx = from;
  while (idx <= content.length) {
    const lineEnd = content.indexOf('\n', idx);
    const line = content.slice(idx, lineEnd === -1 ? content.length : lineEnd).replace(/\r$/, '');
    if (line.trimStart().startsWith(prefix)) return idx;
    if (lineEnd === -1) return -1;
    idx = lineEnd + 1;
  }
  return -1;
}

export function findBlock(content: string): BlockLocation | null {
  const start = lineStartsAt(content, BEGIN_PREFIX);
  if (start === -1) return null;
  const endLine = lineStartsAt(content, END_PREFIX, start);
  if (endLine === -1) throw new Error('NetKit bloğu bozuk: END işareti yok');
  const nl = content.indexOf('\n', endLine);
  return { start, end: nl === -1 ? content.length : nl + 1 };
}

export function isValidEntry(e: HostsEntry): boolean {
  return (
    isValidIP(e.ip) &&
    Array.isArray(e.hostnames) &&
    e.hostnames.length > 0 &&
    e.hostnames.length <= 16 &&
    e.hostnames.every((h) => isValidHostname(h))
  );
}

export function renderBlock(entries: HostsEntry[], eol: string): string {
  const lines = [BLOCK_BEGIN, ...entries.map((e) => `${e.ip}  ${e.hostnames.join(' ')}`), BLOCK_END];
  return lines.join(eol) + eol;
}

/**
 * Blok içeriğini yeniler. entries boşsa blok tamamen kaldırılır ("Tümünü kaldır").
 * Blok yoksa dosyanın sonuna eklenir. Blok dışındaki içerik değişmez.
 */
export function applyBlock(content: string, entries: HostsEntry[]): string {
  const invalid = entries.find((e) => !isValidEntry(e));
  if (invalid) throw new Error(`Geçersiz hosts kaydı: ${invalid.ip}`);
  const eol = detectEol(content);
  const block = entries.length > 0 ? renderBlock(entries, eol) : '';
  const loc = findBlock(content);
  if (loc) return content.slice(0, loc.start) + block + content.slice(loc.end);
  if (!block) return content;
  // Son satırın satır sonu yoksa bloğu yeni satırda başlatmak için ayraç eklenir;
  // bu ayraç blok dışındaki satırların içeriğini değiştirmez.
  const separator = content.length > 0 && !content.endsWith('\n') ? eol : '';
  return content + separator + block;
}

/** Blok dışındaki satırlar (karşılaştırma ve salt okunur gösterim için). */
export function outsideLines(content: string): string[] {
  const loc = findBlock(content);
  const outside = loc ? content.slice(0, loc.start) + content.slice(loc.end) : content;
  const lines = outside.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Bloğun içindeki kayıtlar. */
export function parseBlockEntries(content: string): HostsEntry[] {
  const loc = findBlock(content);
  if (!loc) return [];
  return content
    .slice(loc.start, loc.end)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [ip, ...hostnames] = l.split(/\s+/);
      return { ip, hostnames };
    });
}

/** Açık grupların kayıtlarını tek listeye indirir (aynı IP→ad tekrarları atılır). */
export function entriesFromGroups(groups: HostsGroup[]): HostsEntry[] {
  const seen = new Set<string>();
  const out: HostsEntry[] = [];
  for (const g of groups) {
    if (!g.enabled) continue;
    for (const e of g.entries) {
      const hostnames = e.hostnames.filter((h) => !seen.has(`${e.ip} ${h.toLowerCase()}`));
      hostnames.forEach((h) => seen.add(`${e.ip} ${h.toLowerCase()}`));
      if (hostnames.length > 0) out.push({ ip: e.ip, hostnames });
    }
  }
  return out;
}

/** Aynı alan adı açık gruplarda farklı IP'lere gidiyorsa çakışma döndürür. */
export function findConflicts(groups: HostsGroup[]): HostsConflict[] {
  const map = new Map<string, { ips: Set<string>; groups: Set<string> }>();
  for (const g of groups) {
    if (!g.enabled) continue;
    for (const e of g.entries) {
      for (const h of e.hostnames) {
        const key = h.toLowerCase();
        const item = map.get(key) ?? { ips: new Set(), groups: new Set() };
        item.ips.add(e.ip);
        item.groups.add(g.name);
        map.set(key, item);
      }
    }
  }
  return [...map.entries()]
    .filter(([, v]) => v.ips.size > 1)
    .map(([hostname, v]) => ({ hostname, ips: [...v.ips], groups: [...v.groups] }));
}

/**
 * Yedekten geri yüklenecek içeriğin hosts dosyası biçiminde olduğunu doğrular:
 * her satır boş, yorum ya da "IP ad [ad...] [# yorum]" olmalıdır.
 */
export function isHostsFileContent(content: string): boolean {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_HOSTS_FILE_BYTES) return false;
  if (content.includes('\0')) return false;
  return content.split(/\r?\n/).every((raw) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return true;
    const [ip, ...names] = line.split(/\s+/);
    // Sistem dosyalarında görülen kapsamlı IPv6 (fe80::1%lo0) ve '_' içeren adlara izin verilir.
    return isValidIP(ip.replace(/%[\w.-]+$/, '')) && names.length > 0 && names.every((n) => /^[A-Za-z0-9._-]{1,253}$/.test(n));
  });
}
