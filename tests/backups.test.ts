import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup, listBackups, readBackup } from '../src/core/backups';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'netkit-bak-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('döner yedekler', () => {
  it('son 20 yedek tutulur, en yeni başta', async () => {
    const base = Date.UTC(2026, 9, 12, 8, 0, 0);
    for (let i = 0; i < 25; i++) await createBackup(dir, `içerik ${i}`, 20, new Date(base + i * 1000));
    const list = await listBackups(dir);
    expect(list).toHaveLength(20);
    expect((await readdir(dir)).length).toBe(20);
    expect(await readBackup(dir, list[0].id)).toBe('içerik 24');
    expect(await readBackup(dir, list[19].id)).toBe('içerik 5');
    expect(list[0].createdAt).toBe('2026-10-12T08:00:24.000Z');
  });

  it('aynı milisaniyedeki yedekler çakışmaz', async () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    await createBackup(dir, 'a', 20, now);
    await createBackup(dir, 'b', 20, now);
    const list = await listBackups(dir);
    expect(list).toHaveLength(2);
    expect(await readBackup(dir, list[0].id)).toBe('b');
  });

  it('geçersiz yedek kimliği (yol geçişi) reddedilir', async () => {
    await expect(readBackup(dir, '../../etc/passwd')).rejects.toThrow();
  });
});
