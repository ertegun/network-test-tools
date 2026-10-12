// userData altında küçük JSON dosyaları. Yazma atomiktir (geçici dosya + rename).

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly fallback: () => T,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch {
      return this.fallback();
    }
  }

  async exists(): Promise<boolean> {
    try {
      await readFile(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, this.path);
  }

  async remove(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
