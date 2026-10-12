import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outsideLines } from '../src/core/hosts';
import { handleRequest, runHelperFromFiles, validateRequest } from '../src/helper';
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

  it('hosts geri yükleme yalnızca hosts biçimindeki içeriği kabul eder', async () => {
    const hostsPath = join(dir, 'hosts');
    await writeFile(hostsPath, 'önceki');
    const platform = fakePlatform(hostsPath);
    expect(await handleRequest({ op: 'hosts.restore', params: { content: '#!/bin/sh\nrm -rf /\n' } }, platform)).toMatchObject({ code: 'invalidParams' });
    expect(await readFile(hostsPath, 'utf8')).toBe('önceki');
    expect(await handleRequest({ op: 'hosts.restore', params: { content: '127.0.0.1 localhost\n' } }, platform)).toEqual({ ok: true, output: null });
    expect(await readFile(hostsPath, 'utf8')).toBe('127.0.0.1 localhost\n');
  });

  it('dosya tabanlı giriş noktası sonucu dosyaya yazar', async () => {
    const req = join(dir, 'req.json');
    const res = join(dir, 'res.json');
    await writeFile(req, JSON.stringify({ op: 'calc.exe' }));
    expect(await runHelperFromFiles(req, res, fakePlatform())).toBe(1);
    expect(JSON.parse(await readFile(res, 'utf8'))).toMatchObject({ ok: false, code: 'notWhitelisted' });
  });
});
