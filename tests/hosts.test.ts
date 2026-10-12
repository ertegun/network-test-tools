import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyBlock,
  BLOCK_BEGIN,
  BLOCK_END,
  entriesFromGroups,
  findConflicts,
  isHostsFileContent,
  outsideLines,
  parseBlockEntries,
} from '../src/core/hosts';
import type { HostsGroup } from '../src/shared/types';

const sha = (lines: string[]) => createHash('sha256').update(lines.join('\n')).digest('hex');

const ORIGINAL = [
  '# Copyright (c) 1993-2009 Microsoft Corp.',
  '#',
  '127.0.0.1       localhost',
  '::1             localhost',
  '10.0.0.5   intranet.corp   # el ile eklendi',
  '',
].join('\r\n');

describe('hosts bloğu (M8)', () => {
  it('kabul kriteri: blok dışı satırların hash değeri yazmadan önce ve sonra aynı', () => {
    const before = sha(outsideLines(ORIGINAL));
    const written = applyBlock(ORIGINAL, [{ ip: '127.0.0.1', hostnames: ['proje.local'] }]);
    expect(sha(outsideLines(written))).toBe(before);
    // Blok dışındaki baytlar birebir korunur (CRLF dahil).
    expect(written.startsWith(ORIGINAL)).toBe(true);
    expect(written).toContain(`${BLOCK_BEGIN}\r\n127.0.0.1  proje.local\r\n${BLOCK_END}\r\n`);

    // Mevcut bloğu güncellemek ve kaldırmak da dışarıyı değiştirmez.
    const updated = applyBlock(written, [{ ip: '10.1.1.1', hostnames: ['a.test', 'b.test'] }]);
    expect(sha(outsideLines(updated))).toBe(before);
    expect(parseBlockEntries(updated)).toEqual([{ ip: '10.1.1.1', hostnames: ['a.test', 'b.test'] }]);
    expect(applyBlock(updated, [])).toBe(ORIGINAL);
  });

  it('blok dosyanın ortasındaysa çevresindeki satırlar yerinde kalır', () => {
    const content = `a 1\n${BLOCK_BEGIN}\n1.1.1.1  old.test\n${BLOCK_END}\n# sonra\n2.2.2.2 z.test`;
    const out = applyBlock(content, [{ ip: '3.3.3.3', hostnames: ['new.test'] }]);
    expect(out).toBe(`a 1\n${BLOCK_BEGIN}\n3.3.3.3  new.test\n${BLOCK_END}\n# sonra\n2.2.2.2 z.test`);
  });

  it('son satırda satır sonu yoksa blok yeni satırda başlar', () => {
    const out = applyBlock('127.0.0.1 localhost', [{ ip: '127.0.0.1', hostnames: ['x.local'] }]);
    expect(out).toBe(`127.0.0.1 localhost\n${BLOCK_BEGIN}\n127.0.0.1  x.local\n${BLOCK_END}\n`);
    expect(outsideLines(out)).toEqual(['127.0.0.1 localhost']);
  });

  it('aynı içerikle tekrar yazmak dosyayı değiştirmez', () => {
    const once = applyBlock(ORIGINAL, [{ ip: '127.0.0.1', hostnames: ['proje.local'] }]);
    expect(applyBlock(once, [{ ip: '127.0.0.1', hostnames: ['proje.local'] }])).toBe(once);
  });

  it('geçersiz IP veya alan adı yazılmaz', () => {
    expect(() => applyBlock(ORIGINAL, [{ ip: '999.1.1.1', hostnames: ['a.test'] }])).toThrow();
    expect(() => applyBlock(ORIGINAL, [{ ip: '1.1.1.1', hostnames: ['bad host'] }])).toThrow();
    expect(() => applyBlock(ORIGINAL, [{ ip: '1.1.1.1', hostnames: [] }])).toThrow();
  });

  it('END işareti olmayan bozuk blok yazmayı durdurur', () => {
    expect(() => applyBlock(`${BLOCK_BEGIN}\n1.1.1.1 a.test\n`, [])).toThrow(/END/);
  });

  it('gruplar: yalnızca açık gruplar yazılır, çakışmalar bulunur', () => {
    const groups: HostsGroup[] = [
      { id: '1', name: 'Proje A', enabled: true, entries: [{ ip: '127.0.0.1', hostnames: ['proje.local', 'api.local'] }] },
      { id: '2', name: 'Test', enabled: true, entries: [{ ip: '10.0.0.2', hostnames: ['API.local'] }] },
      { id: '3', name: 'Kapalı', enabled: false, entries: [{ ip: '10.0.0.9', hostnames: ['proje.local'] }] },
    ];
    expect(entriesFromGroups(groups)).toEqual([
      { ip: '127.0.0.1', hostnames: ['proje.local', 'api.local'] },
      { ip: '10.0.0.2', hostnames: ['API.local'] },
    ]);
    expect(findConflicts(groups)).toEqual([{ hostname: 'api.local', ips: ['127.0.0.1', '10.0.0.2'], groups: ['Proje A', 'Test'] }]);
  });

  it('yedekten geri yükleme içeriği hosts biçiminde olmalı', () => {
    expect(isHostsFileContent(ORIGINAL)).toBe(true);
    expect(isHostsFileContent('fe80::1%lo0 localhost\n')).toBe(true);
    expect(isHostsFileContent('rm -rf /\n')).toBe(false);
    expect(isHostsFileContent('1.1.1.1\n')).toBe(false);
    expect(isHostsFileContent('1.1.1.1 a\0b\n')).toBe(false);
  });
});
