// M7: IP/DNS değişikliği, otomatik geri alma, çökme sonrası kurtarma ve profiller.

import { networkInterfaces } from 'node:os';
import { isValidInterfaceName, isValidIPv4, normalizeMask, validateStaticConfig } from '../core/validate';
import type { Platform } from '../platform';
import type { ConfigValidation } from '../shared/api';
import type { ChangeStatus, Ipv4Config, NetProfile, PendingChangeJournal, PrivilegedResult } from '../shared/types';
import type { PrivilegedRunner, PrivilegedSession } from './privileged';
import type { JsonFile } from './store';

export const PREVIOUS_PROFILE = 'Önceki ayar';
const TERMINAL = new Set<ChangeStatus['phase']>(['confirmed', 'rolledBack', 'failed']);

export class ConfigService {
  private session?: PrivilegedSession;
  private status?: ChangeStatus;
  private final?: Promise<ChangeStatus>;

  constructor(
    private readonly platform: Platform,
    private readonly privileged: PrivilegedRunner,
    private readonly journal: JsonFile<PendingChangeJournal | null>,
    private readonly profilesFile: JsonFile<NetProfile[]>,
    private readonly onStatus: (s: ChangeStatus) => void,
  ) {}

  async validate(iface: string, cfg: Ipv4Config): Promise<ConfigValidation> {
    const errors: string[] = [];
    if (!isValidInterfaceName(iface)) errors.push('invalidInterface');
    if (cfg.mode === 'static') errors.push(...validateStaticConfig(cfg));
    else if (!Array.isArray(cfg.dns) || cfg.dns.some((d) => !isValidIPv4(d))) errors.push('invalidDns');
    let conflict = false;
    if (errors.length === 0 && cfg.mode === 'static' && cfg.ip) {
      // Bu makinede zaten olan adres çakışma sayılmaz.
      const own = Object.values(networkInterfaces()).some((list) => list?.some((i) => i.address === cfg.ip));
      if (!own) conflict = await this.platform.ping(cfg.ip, 1000).catch(() => false);
    }
    return { errors, conflict };
  }

  async apply(iface: string, cfg: Ipv4Config): Promise<ChangeStatus> {
    const phase = this.status?.phase;
    if (phase === 'applying' || phase === 'awaitingConfirm' || phase === 'rollingBack') throw new Error('changeInProgress');
    const v = await this.validate(iface, cfg);
    if (v.errors.length > 0) {
      // Geçersiz giriş yardımcıya hiç gitmez; yine de denetim günlüğüne düşmesi için doğrulama yardımcıda da tekrarlanır.
      const status: ChangeStatus = { phase: 'failed', interfaceName: iface, error: v.errors.join(', ') };
      this.onStatus(status);
      return status;
    }
    const normalized: Ipv4Config = cfg.mode === 'static' ? { ...cfg, mask: normalizeMask(cfg.mask ?? '') ?? cfg.mask } : cfg;
    return this.startChange(iface, 'ipv4.change', { interface: iface, config: normalized }, normalized);
  }

  /** Yalnızca DNS sunucularını değiştirir (boş liste: DHCP); onay ve 15 sn geri alma IP değişikliğiyle aynı. */
  async applyDns(iface: string, dns: string[]): Promise<ChangeStatus> {
    const phase = this.status?.phase;
    if (phase === 'applying' || phase === 'awaitingConfirm' || phase === 'rollingBack') throw new Error('changeInProgress');
    const errors: string[] = [];
    if (!isValidInterfaceName(iface)) errors.push('invalidInterface');
    if (!Array.isArray(dns) || dns.length > 4 || dns.some((d) => !isValidIPv4(d))) errors.push('invalidDns');
    if (errors.length > 0) {
      const status: ChangeStatus = { phase: 'failed', interfaceName: iface, error: errors.join(', ') };
      this.onStatus(status);
      return status;
    }
    return this.startChange(iface, 'dns.change', { interface: iface, dns }, { dns });
  }

  private startChange(iface: string, op: string, params: unknown, next: unknown): Promise<ChangeStatus> {
    // Yedek, uygulama ve 15 sn geri alma yetkili yardımcının içinde yürür (tek yetki penceresi).
    let settle!: (s: ChangeStatus) => void;
    let ready!: (s: ChangeStatus) => void;
    this.final = new Promise((r) => (settle = r));
    const started = new Promise<ChangeStatus>((r) => (ready = r));
    const emit = (s: ChangeStatus) => {
      this.status = s;
      this.onStatus(s);
      if (TERMINAL.has(s.phase)) {
        settle(s);
        ready(s);
      } else if (s.phase === 'awaitingConfirm' && s.connectivityOk !== undefined) ready(s);
    };
    emit({ phase: 'applying', interfaceName: iface });
    const session = this.privileged.start(
      op,
      params,
      { next },
      {
        onStatus: emit,
        onJournal: async (j) => {
          if (!j) return this.journal.remove();
          await this.journal.write(j);
          await this.saveProfile({ name: PREVIOUS_PROFILE, config: j.previous });
        },
      },
    );
    this.session = session;
    void session.result.then((r) => {
      if (this.session === session) this.session = undefined;
      // Yardımcı sonuçlanmadan çıktıysa (iptal, çökme) değişiklik başarısız sayılır; günlük varsa kurtarma önerilir.
      if (this.status && !TERMINAL.has(this.status.phase)) emit({ phase: 'failed', interfaceName: iface, error: r.ok ? 'yardımcı sonuç bildirmedi' : r.message });
    });
    return started;
  }

  async confirm(): Promise<boolean> {
    if (!this.session || this.status?.phase !== 'awaitingConfirm') return false;
    this.session.command('confirm');
    return (await this.final)?.phase === 'confirmed';
  }

  async revert(): Promise<void> {
    if (!this.session || this.status?.phase !== 'awaitingConfirm') return;
    this.session.command('revert');
    await this.final;
  }

  pendingRecovery(): Promise<PendingChangeJournal | null> {
    return this.journal.read();
  }

  /** Yarım kalmış değişiklikte önceki ayarı geri yükler. */
  async recover(): Promise<PrivilegedResult> {
    const j = await this.journal.read();
    if (!j) return { ok: true };
    // Yalnızca DNS değiştiyse yalnızca DNS geri yüklenir; adres ayarı yeniden yazılmaz.
    const addr = (c: Ipv4Config) => JSON.stringify({ ...c, dns: [] });
    const dnsOnly = addr(j.previous) === addr(j.next);
    const r = dnsOnly
      ? await this.privileged.run('dns.apply', { interface: j.interfaceName, dns: j.previous.dns }, { previous: j.next, next: j.previous })
      : await this.privileged.run('ipv4.apply', { interface: j.interfaceName, config: j.previous }, { previous: j.next, next: j.previous });
    if (r.ok) await this.journal.remove();
    return r;
  }

  dismissRecovery(): Promise<void> {
    return this.journal.remove();
  }

  profiles(): Promise<NetProfile[]> {
    return this.profilesFile.read();
  }

  async saveProfile(p: NetProfile): Promise<NetProfile[]> {
    const name = (p.name ?? '').trim();
    if (!name || name.length > 64) throw new Error('invalidName');
    const list = (await this.profilesFile.read()).filter((x) => x.name !== name);
    list.push({ name, config: p.config });
    await this.profilesFile.write(list);
    return list;
  }

  async deleteProfile(name: string): Promise<NetProfile[]> {
    const list = (await this.profilesFile.read()).filter((x) => x.name !== name);
    await this.profilesFile.write(list);
    return list;
  }
}
