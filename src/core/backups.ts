// Döner yedekler: her yazmadan önce tam kopya alınır, en yeni N adet saklanır.

import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_KEEP = 20;
const NAME = /^(\d{8}T\d{9})(?:-(\d+))?\.bak$/;

export interface BackupInfo {
  id: string;
  createdAt: string;
  size: number;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:.Z]/g, '');
}

function parseStamp(s: string): string {
  // 20261012T084500123 → ISO
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : s;
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items = await Promise.all(
    names
      .filter((n) => NAME.test(n))
      .map(async (n) => ({ id: n, createdAt: parseStamp(NAME.exec(n)![1]), size: (await stat(join(dir, n))).size })),
  );
  // En yeni önce: zaman damgası, aynı ms içinde sayaç eki.
  const key = (id: string) => {
    const m = NAME.exec(id)!;
    return [m[1], Number(m[2] ?? 0)] as const;
  };
  return items.sort((a, b) => {
    const [sa, ca] = key(a.id);
    const [sb, cb] = key(b.id);
    return sa === sb ? cb - ca : sa < sb ? 1 : -1;
  });
}

export async function createBackup(dir: string, content: string, keep = DEFAULT_KEEP, now = new Date()): Promise<string> {
  await mkdir(dir, { recursive: true });
  const base = stamp(now);
  let id = `${base}.bak`;
  for (let i = 1; ; i++) {
    try {
      await writeFile(join(dir, id), content, { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      id = `${base}-${i}.bak`;
    }
  }
  const all = await listBackups(dir);
  await Promise.all(all.slice(keep).map((b) => unlink(join(dir, b.id))));
  return id;
}

export async function readBackup(dir: string, id: string): Promise<string> {
  if (!NAME.test(id)) throw new Error('Geçersiz yedek kimliği');
  return readFile(join(dir, id), 'utf8');
}
