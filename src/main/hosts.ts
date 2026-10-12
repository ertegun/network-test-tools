// M8: hosts grupları, yedek ve yazma. Okuma ve yedekleme normal kullanıcı yetkisiyle
// yapılır; yazma yalnızca yetkili yardımcının "hosts.*" işlemleriyle olur.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createBackup, listBackups, readBackup } from '../core/backups';
import { entriesFromGroups, findConflicts, isValidEntry, outsideLines, parseBlockEntries } from '../core/hosts';
import type { Platform } from '../platform';
import type { HostsGroup, HostsView, PrivilegedResult } from '../shared/types';
import type { PrivilegedRunner } from './privileged';
import type { JsonFile } from './store';

export const IMPORTED_GROUP = 'NetKit';

export class HostsService {
  constructor(
    private readonly platform: Platform,
    private readonly privileged: PrivilegedRunner,
    private readonly groupsFile: JsonFile<HostsGroup[]>,
    private readonly backupDir: string,
  ) {}

  private readHosts(): Promise<string> {
    return readFile(this.platform.hostsPath(), 'utf8');
  }

  private async groups(content: string): Promise<HostsGroup[]> {
    if (await this.groupsFile.exists()) return this.groupsFile.read();
    // İlk açılışta dosyadaki mevcut NetKit bloğu tek grup olarak içe alınır.
    const existing = parseBlockEntries(content).filter(isValidEntry);
    return existing.length > 0 ? [{ id: randomUUID(), name: IMPORTED_GROUP, enabled: true, entries: existing }] : [];
  }

  async view(): Promise<HostsView> {
    const content = await this.readHosts();
    const groups = await this.groups(content);
    return {
      path: this.platform.hostsPath(),
      outsideLines: outsideLines(content),
      groups,
      conflicts: findConflicts(groups),
      backups: await listBackups(this.backupDir),
    };
  }

  /** Grupları uygulama içinde kaydeder (sistem dosyasına yazmaz). Geçersiz kayıt reddedilir. */
  async saveGroups(groups: HostsGroup[]): Promise<HostsView> {
    if (!Array.isArray(groups)) throw new Error('invalidGroups');
    const clean = groups.map((g) => ({
      id: typeof g.id === 'string' && g.id ? g.id : randomUUID(),
      name: String(g.name ?? '').trim().slice(0, 64) || '—',
      enabled: Boolean(g.enabled),
      entries: (g.entries ?? []).map((e) => ({ ip: String(e.ip).trim(), hostnames: (e.hostnames ?? []).map((h) => String(h).trim()).filter(Boolean) })),
    }));
    const invalid = clean.flatMap((g) => g.entries).find((e) => !isValidEntry(e));
    if (invalid) throw new Error(`invalidEntry:${invalid.ip} ${invalid.hostnames.join(' ')}`);
    await this.groupsFile.write(clean);
    return this.view();
  }

  private async backupCurrent(): Promise<void> {
    // Yedeksiz yazma yapılmaz: yedek alınamazsa istisna yukarı çıkar.
    await createBackup(this.backupDir, await this.readHosts());
  }

  async apply(): Promise<PrivilegedResult> {
    const content = await this.readHosts();
    const entries = entriesFromGroups(await this.groups(content));
    await this.backupCurrent();
    return this.privileged.run('hosts.writeBlock', { entries }, { previous: parseBlockEntries(content), next: entries });
  }

  async removeAll(): Promise<PrivilegedResult> {
    const content = await this.readHosts();
    await this.backupCurrent();
    return this.privileged.run('hosts.writeBlock', { entries: [] }, { previous: parseBlockEntries(content), next: [] });
  }

  /** Yedekteki yalnızca NetKit bloğu geri yüklenir; blok dışı satırlara dokunulmaz (Gereksinim 7). */
  async restore(backupId: string): Promise<PrivilegedResult> {
    const entries = parseBlockEntries(await readBackup(this.backupDir, backupId)).filter(isValidEntry);
    const content = await this.readHosts();
    await this.backupCurrent();
    return this.privileged.run('hosts.writeBlock', { entries }, { previous: parseBlockEntries(content), next: entries });
  }
}
