// M7: onaylı IP/DNS değişikliği yetkili yardımcının içinde yürür. Yedek (mevcut ayar)
// yardımcı tarafından okunur, değişiklik uygulanır ve 15 sn zamanlayıcı da burada çalışır.
// Onay gelmezse, main kapanırsa ya da bağlantı koparsa eski ayar aynı yetkili süreçten geri
// yüklenir; ikinci bir yetki penceresi açılmaz.

import { networkInterfaces } from 'node:os';
import { CONFIRM_TIMEOUT_MS, ConfirmableChange } from '../core/rollback';
import type { Platform } from '../platform';
import type { ChangeStatus, Ipv4Config, PendingChangeJournal } from '../shared/types';

const DHCP_WAIT_MS = 8000;

export type ChangeCommand = 'confirm' | 'revert' | 'disconnect';

/** Yardımcının main ile konuştuğu yüzey. */
export interface SessionContext {
  status(s: ChangeStatus): void;
  /** Günlüğü main'e kaydettirir; kayıt doğrulanmadan değişiklik uygulanmaz. */
  saveJournal(j: PendingChangeJournal | null): Promise<void>;
  onCommand(cb: (c: ChangeCommand) => void): void;
  confirmTimeoutMs?: number;
}

const TERMINAL = new Set<ChangeStatus['phase']>(['confirmed', 'rolledBack', 'failed']);

/** Yeni ayar etkin olduktan sonra ağ geçidine ulaşılabiliyor mu? */
export async function verifyConnectivity(platform: Platform, iface: string, cfg: Ipv4Config): Promise<boolean> {
  const deadline = Date.now() + DHCP_WAIT_MS;
  // DHCP'de adres gelene kadar kısa süre beklenir.
  while (Date.now() < deadline) {
    const has = networkInterfaces()[iface]?.some((i) => i.family === 'IPv4' && !i.address.startsWith('169.254.'));
    if (has) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const details = cfg.mode === 'static' ? {} : await platform.interfaceDetails().catch(() => ({}) as Awaited<ReturnType<Platform['interfaceDetails']>>);
  const gateway = cfg.mode === 'static' ? cfg.gateway : details[iface]?.gateway;
  if (!gateway) return false;
  return platform.ping(gateway, 1500).catch(() => false);
}

/** Yalnızca DNS'i yazar ve geri okur; okunan değer yazılanla uyuşmazsa hata verir (geri alma tetiklenir). */
export async function applyDnsChecked(platform: Platform, iface: string, dns: string[]): Promise<void> {
  await platform.applyDns(iface, dns);
  const actual = (await platform.readIpv4Config(iface)).dns;
  if (actual.join(',') !== dns.join(',')) throw new Error(`dnsMismatch: ${actual.join(', ') || '-'}`);
}

/** Değişikliği uygular ve onay/geri alma sonuçlanana kadar bekler. Son durumu döndürür. */
export async function runConfirmableChange(
  iface: string,
  next: Ipv4Config,
  platform: Platform,
  ctx: SessionContext,
  // Hem yeni ayarı hem geri almada eski ayarı yazar; DNS değişikliğinde yalnızca DNS yazılır.
  apply: (iface: string, cfg: Ipv4Config) => Promise<void> = (i, c) => platform.applyIpv4(i, c),
): Promise<ChangeStatus> {
  let finish!: (s: ChangeStatus) => void;
  const done = new Promise<ChangeStatus>((r) => (finish = r));
  const change = new ConfirmableChange(
    {
      snapshot: (i) => platform.readIpv4Config(i),
      apply,
      verifyConnectivity: (i, c) => verifyConnectivity(platform, i, c),
      writeJournal: (j) => ctx.saveJournal(j),
      clearJournal: () => ctx.saveJournal(null),
      onStatus: (s) => {
        ctx.status(s);
        if (TERMINAL.has(s.phase)) finish(s);
      },
    },
    ctx.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS,
  );
  ctx.onCommand((c) => {
    // Main yoksa kullanıcı onay veremez: süre beklenmeden geri alınır.
    if (c === 'confirm') void change.confirm();
    else void change.revertNow();
  });
  // Bağlantı testi sürerken de geri alma sonuçlanabilir; bu yüzden start beklenmez, son durum beklenir.
  change.start(iface, next).catch((err: Error) => {
    // Günlük kaydedilemedi: değişiklik uygulanmadı.
    const s: ChangeStatus = { phase: 'failed', interfaceName: iface, error: `journal: ${err.message}` };
    ctx.status(s);
    finish(s);
  });
  return done;
}
