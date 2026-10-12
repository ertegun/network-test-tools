import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outsideLines } from '../src/core/hosts';
import { CONFIRM_TIMEOUT_MS } from '../src/core/rollback';
import { handleRequest, validateRequest } from '../src/helper';
import type { ChangeCommand, SessionContext } from '../src/helper/change';
import type { Platform } from '../src/platform';
import type { ChangeStatus, Ipv4Config, PendingChangeJournal } from '../src/shared/types';
import { fakePlatform } from './fakePlatform';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'netkit-helper-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const sha = (s: string) => createHash('sha256').update(outsideLines(s).join('\n')).digest('hex');

describe('yetkili yardımcı beyaz listesi (Gereksinim 8)', () => {
  it.each(['calc.exe', 'rm -rf', 'rm -rf /', 'powershell', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'beyaz liste dışı işlem reddedilir ve hiçbir şey çalışmaz: %s',
    async (op) => {
      const platform = fakePlatform();
      const r = await handleRequest({ op, params: {} }, platform);
      expect(r).toMatchObject({ ok: false, code: 'notWhitelisted' });
      expect(platform.applyIpv4).not.toHaveBeenCalled();
      expect(platform.flushDns).not.toHaveBeenCalled();
    },
  );

  it('istek nesne değilse reddedilir', () => {
    expect(validateRequest(null)).toMatchObject({ ok: false });
    expect(validateRequest('ipv4.apply')).toMatchObject({ ok: false });
  });

  it('kabul kriteri (M7): geçersiz IP 999.1.1.1 ile değişiklik uygulanmaz', async () => {
    const platform = fakePlatform();
    const r = await handleRequest(
      { op: 'ipv4.apply', params: { interface: 'Ethernet', config: { mode: 'static', ip: '999.1.1.1', mask: '255.255.255.0', dns: [] } } },
      platform,
    );
    expect(r).toMatchObject({ ok: false, code: 'invalidParams' });
    expect(platform.applyIpv4).not.toHaveBeenCalled();
  });

  it('beklenmeyen alanlar ve zararlı arayüz adı reddedilir', async () => {
    const platform = fakePlatform();
    const bad = [
      { interface: 'eth0; rm -rf /', config: { mode: 'dhcp', dns: [] } },
      { interface: '-rf', config: { mode: 'dhcp', dns: [] } },
      { interface: 'eth0', config: { mode: 'dhcp', dns: [] }, command: 'calc.exe' },
      { interface: 'eth0', config: { mode: 'dhcp', dns: ['1.1.1.1 & calc'] } },
      { interface: 'eth0', config: { mode: 'static', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '10.0.1.1', dns: [] } },
    ];
    for (const params of bad) {
      expect(await handleRequest({ op: 'ipv4.apply', params }, platform)).toMatchObject({ ok: false, code: 'invalidParams' });
    }
    expect(platform.applyIpv4).not.toHaveBeenCalled();
  });

  it('geçerli istek platforma normalize edilmiş parametreyle gider', async () => {
    const platform = fakePlatform();
    const r = await handleRequest(
      { op: 'ipv4.apply', params: { interface: 'Ethernet 2', config: { mode: 'static', ip: '192.168.1.10', mask: '/24', gateway: '192.168.1.1', dns: ['1.1.1.1'] } } },
      platform,
    );
    expect(r).toEqual({ ok: true, output: null });
    expect(platform.applyIpv4).toHaveBeenCalledWith('Ethernet 2', { mode: 'static', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1', dns: ['1.1.1.1'] });
  });

  it('kabul kriteri (M8): hosts yazımında blok dışı satırların hash değeri değişmez, DNS önbelleği temizlenir', async () => {
    const hostsPath = join(dir, 'hosts');
    const original = '# sistem\r\n127.0.0.1 localhost\r\n10.0.0.5 elle.eklendi\r\n';
    await writeFile(hostsPath, original);
    const platform = fakePlatform(hostsPath);
    const r = await handleRequest({ op: 'hosts.writeBlock', params: { entries: [{ ip: '127.0.0.1', hostnames: ['proje.local'] }] } }, platform);
    expect(r).toEqual({ ok: true, output: { changed: true } });
    const after = await readFile(hostsPath, 'utf8');
    expect(sha(after)).toBe(sha(original));
    expect(after).toContain('127.0.0.1  proje.local');
    expect(platform.flushDns).toHaveBeenCalledTimes(1);
  });

  it('hosts kayıtlarında geçersiz IP/alan adı reddedilir', async () => {
    const platform = fakePlatform(join(dir, 'hosts'));
    for (const entries of [[{ ip: '999.1.1.1', hostnames: ['a.test'] }], [{ ip: '1.1.1.1', hostnames: ['a b'] }], [{ ip: '1.1.1.1', hostnames: ['a.test'], extra: 1 }], 'x']) {
      expect(await handleRequest({ op: 'hosts.writeBlock', params: { entries } }, platform)).toMatchObject({ ok: false, code: 'invalidParams' });
    }
  });

  it('tam hosts dosyası yazan işlem beyaz listede değildir (Gereksinim 7)', async () => {
    const hostsPath = join(dir, 'hosts');
    await writeFile(hostsPath, 'önceki');
    const platform = fakePlatform(hostsPath);
    expect(await handleRequest({ op: 'hosts.restore', params: { content: '127.0.0.1 localhost\n' } }, platform)).toMatchObject({ code: 'notWhitelisted' });
    expect(await readFile(hostsPath, 'utf8')).toBe('önceki');
  });
});

describe('yardımcı içinde onaylı değişiklik (M7, ipv4.change)', () => {
  const PREVIOUS: Ipv4Config = { mode: 'dhcp', dns: [] };
  const WRONG: Ipv4Config = { mode: 'static', ip: '10.99.99.99', mask: '255.255.255.0', gateway: '10.99.99.1', dns: [] };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function context() {
    let command: ((c: ChangeCommand) => void) | undefined;
    const journal: (PendingChangeJournal | null)[] = [];
    const statuses: ChangeStatus[] = [];
    const ctx: SessionContext = {
      status: (s) => statuses.push(s),
      saveJournal: vi.fn(async (j: PendingChangeJournal | null) => {
        journal.push(j);
      }),
      onCommand: (cb) => (command = cb),
    };
    return { ctx, journal, statuses, send: (c: ChangeCommand) => command?.(c) };
  }

  function platformWithPrevious() {
    const platform = fakePlatform();
    vi.mocked(platform.readIpv4Config).mockResolvedValue(PREVIOUS);
    return platform;
  }

  const change = (platform: Platform, ctx: SessionContext) =>
    handleRequest({ op: 'ipv4.change', params: { interface: 'Ethernet', config: WRONG } }, platform, ctx);

  it('kabul kriteri: onay gelmezse yardımcı 15 sn sonunda eski ayarı kendisi geri yükler', async () => {
    const platform = platformWithPrevious();
    const { ctx, journal, statuses } = context();
    const done = change(platform, ctx);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS - 1);
    expect(vi.mocked(platform.applyIpv4).mock.calls).toEqual([['Ethernet', WRONG]]);
    await vi.advanceTimersByTimeAsync(1);
    const r = await done;
    expect(vi.mocked(platform.applyIpv4).mock.calls).toEqual([
      ['Ethernet', WRONG],
      ['Ethernet', PREVIOUS],
    ]);
    expect(r).toMatchObject({ ok: true, output: { phase: 'rolledBack' } });
    expect(statuses.map((s) => s.phase)).toContain('awaitingConfirm');
    // Yedek yardımcı tarafından okunur ve uygulamadan önce günlüğe yazılır, sonra silinir.
    expect(journal).toEqual([expect.objectContaining({ interfaceName: 'Ethernet', previous: PREVIOUS, next: WRONG }), null]);
  });

  it('onay gelirse geri alma yapılmaz', async () => {
    const platform = platformWithPrevious();
    const { ctx, send } = context();
    const done = change(platform, ctx);
    await vi.advanceTimersByTimeAsync(3000);
    send('confirm');
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS * 2);
    expect(await done).toMatchObject({ ok: true, output: { phase: 'confirmed' } });
    expect(platform.applyIpv4).toHaveBeenCalledTimes(1);
  });

  it('main bağlantısı koparsa süre beklenmeden eski ayara dönülür', async () => {
    const platform = platformWithPrevious();
    const { ctx, send } = context();
    const done = change(platform, ctx);
    await vi.advanceTimersByTimeAsync(3000);
    send('disconnect');
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toMatchObject({ ok: true, output: { phase: 'rolledBack' } });
    expect(vi.mocked(platform.applyIpv4).mock.calls.at(-1)).toEqual(['Ethernet', PREVIOUS]);
  });

  it('günlük kaydedilemezse değişiklik uygulanmaz', async () => {
    const platform = platformWithPrevious();
    const { ctx } = context();
    ctx.saveJournal = vi.fn(async () => Promise.reject(new Error('main yok')));
    const r = await change(platform, ctx);
    expect(r).toMatchObject({ ok: true, output: { phase: 'failed' } });
    expect(platform.applyIpv4).not.toHaveBeenCalled();
  });

  it('kabul kriteri (M7): geçersiz IP 999.1.1.1 ile onaylı değişiklik de başlamaz', async () => {
    const platform = platformWithPrevious();
    const r = await handleRequest(
      { op: 'ipv4.change', params: { interface: 'Ethernet', config: { mode: 'static', ip: '999.1.1.1', mask: '255.255.255.0', dns: [] } } },
      platform,
      context().ctx,
    );
    expect(r).toMatchObject({ ok: false, code: 'invalidParams' });
    expect(platform.readIpv4Config).not.toHaveBeenCalled();
    expect(platform.applyIpv4).not.toHaveBeenCalled();
  });
});
