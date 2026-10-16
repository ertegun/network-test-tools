import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../src/main/config';
import type { PrivilegedRunner } from '../src/main/privileged';
import { JsonFile } from '../src/main/store';
import type { NetProfile, PendingChangeJournal } from '../src/shared/types';
import { fakePlatform } from './fakePlatform';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'netkit-config-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function service() {
  const privileged = { run: vi.fn(async () => ({ ok: true as const })), start: vi.fn() };
  const journal = new JsonFile<PendingChangeJournal | null>(join(dir, 'pending.json'), () => null);
  const statuses: unknown[] = [];
  const config = new ConfigService(
    fakePlatform(),
    privileged as unknown as PrivilegedRunner,
    journal,
    new JsonFile<NetProfile[]>(join(dir, 'profiles.json'), () => []),
    (s) => statuses.push(s),
  );
  return { config, privileged, journal, statuses };
}

describe('ConfigService DNS değişikliği', () => {
  it('geçersiz DNS yetki istenmeden reddedilir', async () => {
    const { config, privileged } = service();
    expect(await config.applyDns('Ethernet', ['1.2.3'])).toMatchObject({ phase: 'failed', error: 'invalidDns' });
    expect(privileged.start).not.toHaveBeenCalled();
  });

  it('çökme sonrası kurtarma: yalnızca DNS değiştiyse yalnızca önceki DNS geri yüklenir', async () => {
    const { config, privileged, journal } = service();
    const previous = { mode: 'dhcp' as const, dns: [] };
    await journal.write({ interfaceName: 'Ethernet', previous, next: { ...previous, dns: ['1.1.1.1'] }, startedAt: '' });
    expect(await config.recover()).toEqual({ ok: true });
    expect(privileged.run).toHaveBeenCalledWith('dns.apply', { interface: 'Ethernet', dns: [] }, expect.anything());
    expect(await journal.read()).toBeNull();
  });

  it('çökme sonrası kurtarma: adres de değiştiyse tüm önceki ayar geri yüklenir', async () => {
    const { config, privileged, journal } = service();
    const previous = { mode: 'dhcp' as const, dns: [] };
    const next = { mode: 'static' as const, ip: '10.0.0.5', mask: '255.255.255.0', dns: [] };
    await journal.write({ interfaceName: 'Ethernet', previous, next, startedAt: '' });
    await config.recover();
    expect(privileged.run).toHaveBeenCalledWith('ipv4.apply', { interface: 'Ethernet', config: previous }, expect.anything());
  });
});
