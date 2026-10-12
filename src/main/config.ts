// M7: IP/DNS değişikliği, otomatik geri alma, çökme sonrası kurtarma ve profiller.

import { networkInterfaces } from 'node:os';
import { ConfirmableChange } from '../core/rollback';
import { isValidInterfaceName, isValidIPv4, normalizeMask, validateStaticConfig } from '../core/validate';
import type { Platform } from '../platform';
import type { ConfigValidation } from '../shared/api';
import type { ChangeStatus, Ipv4Config, NetProfile, PendingChangeJournal, PrivilegedResult } from '../shared/types';
import type { PrivilegedRunner } from './privileged';
import type { JsonFile } from './store';

export const PREVIOUS_PROFILE = 'Önceki ayar';
const DHCP_WAIT_MS = 8000;

export class ConfigService {
  private change?: ConfirmableChange;

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
    const phase = this.change?.current?.phase;
    if (phase === 'applying' || phase === 'awaitingConfirm' || phase === 'rollingBack') throw new Error('changeInProgress');
    const v = await this.validate(iface, cfg);
    if (v.errors.length > 0) {
      // Geçersiz giriş yardımcıya hiç gitmez; yine de denetim günlüğüne düşmesi için doğrulama yardımcıda da tekrarlanır.
      const status: ChangeStatus = { phase: 'failed', interfaceName: iface, error: v.errors.join(', ') };
      this.onStatus(status);
      return status;
    }
    const normalized: Ipv4Config = cfg.mode === 'static' ? { ...cfg, mask: normalizeMask(cfg.mask ?? '') ?? cfg.mask } : cfg;
    let previous: Ipv4Config | undefined;
    this.change = new ConfirmableChange({
      snapshot: async (i) => {
        previous = await this.platform.readIpv4Config(i);
        await this.saveProfile({ name: PREVIOUS_PROFILE, config: previous });
        return previous;
      },
      apply: async (i, c) => {
        const r = await this.privileged.run('ipv4.apply', { interface: i, config: c }, { previous: c === normalized ? previous : normalized, next: c });
        if (!r.ok) throw new Error(r.message);
      },
      verifyConnectivity: (i, c) => this.verify(i, c),
      writeJournal: (j) => this.journal.write(j),
      clearJournal: () => this.journal.remove(),
      onStatus: this.onStatus,
    });
    return this.change.start(iface, normalized);
  }

  confirm(): Promise<boolean> {
    return this.change?.confirm() ?? Promise.resolve(false);
  }

  async revert(): Promise<void> {
    await this.change?.revertNow();
  }

  private async verify(iface: string, cfg: Ipv4Config): Promise<boolean> {
    const deadline = Date.now() + DHCP_WAIT_MS;
    // DHCP'de adres gelene kadar kısa süre beklenir.
    while (Date.now() < deadline) {
      const has = networkInterfaces()[iface]?.some((i) => i.family === 'IPv4' && !i.address.startsWith('169.254.'));
      if (has) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const details = cfg.mode === 'static' ? {} : await this.platform.interfaceDetails().catch(() => ({}) as Awaited<ReturnType<Platform['interfaceDetails']>>);
    const gateway = cfg.mode === 'static' ? cfg.gateway : details[iface]?.gateway;
    if (!gateway) return false;
    return this.platform.ping(gateway, 1500).catch(() => false);
  }

  pendingRecovery(): Promise<PendingChangeJournal | null> {
    return this.journal.read();
  }

  /** Yarım kalmış değişiklikte önceki ayarı geri yükler. */
  async recover(): Promise<PrivilegedResult> {
    const j = await this.journal.read();
    if (!j) return { ok: true };
    const r = await this.privileged.run('ipv4.apply', { interface: j.interfaceName, config: j.previous }, { previous: j.next, next: j.previous });
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
