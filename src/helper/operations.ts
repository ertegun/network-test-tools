// Yetkili yardımcının beyaz listesi (Gereksinim 8). Yalnızca burada tanımlı işlemler
// çalışır; her işlemin parametreleri çalıştırılmadan önce doğrulanır. Serbest komut yoktur.

import { readFile, writeFile } from 'node:fs/promises';
import { applyBlock, isValidEntry, MAX_HOSTS_FILE_BYTES } from '../core/hosts';
import { isValidInterfaceName, isValidIPv4, normalizeMask, validateStaticConfig } from '../core/validate';
import type { Platform } from '../platform';
import type { HostsEntry, Ipv4Config } from '../shared/types';
import { applyDnsChecked, runConfirmableChange, type SessionContext } from './change';

export class InvalidParamsError extends Error {}

interface Operation<P> {
  /** Ham parametreyi doğrular ve tipli hale getirir; geçersizse InvalidParamsError. */
  parse(raw: unknown): P;
  run(params: P, platform: Platform, ctx: SessionContext): Promise<unknown>;
}

function obj(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidParamsError('parametre nesnesi bekleniyor');
  return raw as Record<string, unknown>;
}

function onlyKeys(o: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new InvalidParamsError(`beklenmeyen alan: ${extra.join(', ')}`);
}

function parseInterface(v: unknown): string {
  if (typeof v !== 'string' || !isValidInterfaceName(v)) throw new InvalidParamsError('geçersiz arayüz adı');
  return v;
}

function parseDns(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((d) => typeof d !== 'string' || !isValidIPv4(d)) || v.length > 4) {
    throw new InvalidParamsError('geçersiz DNS sunucusu');
  }
  return v as string[];
}

export function parseIpv4Config(raw: unknown): Ipv4Config {
  const o = obj(raw);
  onlyKeys(o, ['mode', 'ip', 'mask', 'gateway', 'dns']);
  if (o.mode !== 'dhcp' && o.mode !== 'static') throw new InvalidParamsError('geçersiz mod');
  const dns = parseDns(o.dns);
  if (o.mode === 'dhcp') return { mode: 'dhcp', dns };
  for (const k of ['ip', 'mask', 'gateway'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new InvalidParamsError(`geçersiz ${k}`);
  }
  const cfg: Ipv4Config = { mode: 'static', ip: o.ip as string, mask: o.mask as string, gateway: (o.gateway as string) || undefined, dns };
  const errors = validateStaticConfig(cfg);
  if (errors.length > 0) throw new InvalidParamsError(errors.join(', '));
  return { ...cfg, mask: normalizeMask(cfg.mask!)! };
}

function parseEntries(v: unknown): HostsEntry[] {
  if (!Array.isArray(v) || v.length > 5000) throw new InvalidParamsError('geçersiz kayıt listesi');
  return v.map((e) => {
    const o = obj(e);
    onlyKeys(o, ['ip', 'hostnames']);
    const entry = { ip: o.ip as string, hostnames: o.hostnames as string[] };
    if (typeof entry.ip !== 'string' || !Array.isArray(entry.hostnames) || !isValidEntry(entry)) {
      throw new InvalidParamsError(`geçersiz hosts kaydı: ${String(o.ip)}`);
    }
    return entry;
  });
}

async function writeHosts(path: string, content: string): Promise<void> {
  // Yerinde yazılır: dosyanın sahipliği, ACL'i ve SELinux etiketi korunur.
  // Her yazmadan önce main tam yedek alır; yarım yazma yedekten geri yüklenebilir.
  await writeFile(path, content, 'utf8');
}

const defineOp = <P>(op: Operation<P>) => op;

function parseIfaceConfig(raw: unknown) {
  const o = obj(raw);
  onlyKeys(o, ['interface', 'config']);
  return { iface: parseInterface(o.interface), config: parseIpv4Config(o.config) };
}

function parseIfaceDns(raw: unknown) {
  const o = obj(raw);
  onlyKeys(o, ['interface', 'dns']);
  return { iface: parseInterface(o.interface), dns: parseDns(o.dns) };
}

export const OPERATIONS = {
  /** Onaylı değişiklik: yedek, uygulama ve 15 sn geri alma aynı yetkili süreçte. */
  'ipv4.change': defineOp({
    parse: parseIfaceConfig,
    run(p: { iface: string; config: Ipv4Config }, platform: Platform, ctx: SessionContext) {
      return runConfirmableChange(p.iface, p.config, platform, ctx);
    },
  }),
  /** Yalnızca çökme sonrası kurtarmada önceki ayarı geri yüklemek için. */
  'ipv4.apply': defineOp({
    parse: parseIfaceConfig,
    async run(p: { iface: string; config: Ipv4Config }, platform: Platform) {
      await platform.applyIpv4(p.iface, p.config);
      return null;
    },
  }),
  /** Onaylı DNS değişikliği: yalnızca DNS yazılır, adres ayarına dokunulmaz; geri almada eski DNS yazılır. */
  'dns.change': defineOp({
    parse: parseIfaceDns,
    async run(p: { iface: string; dns: string[] }, platform: Platform, ctx: SessionContext) {
      const next = { ...(await platform.readIpv4Config(p.iface)), dns: p.dns };
      return runConfirmableChange(p.iface, next, platform, ctx, (i, c) => applyDnsChecked(platform, i, c.dns));
    },
  }),
  /** Yalnızca DNS değişikliğinin çökme sonrası kurtarmasında önceki DNS'i geri yüklemek için. */
  'dns.apply': defineOp({
    parse: parseIfaceDns,
    async run(p: { iface: string; dns: string[] }, platform: Platform) {
      await platform.applyDns(p.iface, p.dns);
      return null;
    },
  }),
  'dns.flush': defineOp({
    parse(raw: unknown) {
      onlyKeys(obj(raw ?? {}), []);
      return {};
    },
    async run(_p: object, platform: Platform) {
      await platform.flushDns();
      return null;
    },
  }),
  'hosts.writeBlock': defineOp({
    parse(raw: unknown) {
      const o = obj(raw);
      onlyKeys(o, ['entries']);
      return { entries: parseEntries(o.entries) };
    },
    async run(p: { entries: HostsEntry[] }, platform: Platform) {
      // Dosya yardımcı tarafından yeniden okunur; yalnızca NetKit bloğu değişir.
      const path = platform.hostsPath();
      const before = await readFile(path, 'utf8');
      if (Buffer.byteLength(before) > MAX_HOSTS_FILE_BYTES) throw new Error('hosts dosyası çok büyük');
      const after = applyBlock(before, p.entries);
      if (after !== before) await writeHosts(path, after);
      await platform.flushDns().catch(() => undefined);
      return { changed: after !== before };
    },
  }),
};

export type OperationName = keyof typeof OPERATIONS;

export function isWhitelisted(op: unknown): op is OperationName {
  return typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPERATIONS, op);
}
