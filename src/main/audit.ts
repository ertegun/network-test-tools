// Yerel denetim günlüğü: sistem ayarı değiştiren her işlem ve her reddedilen istek
// JSON satırı olarak eklenir (zaman, işlem, önceki/yeni değer, sonuç).

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AuditEntry {
  op: string;
  params?: unknown;
  previous?: unknown;
  next?: unknown;
  outcome: 'ok' | 'rejected' | 'cancelled' | 'failed';
  message?: string;
}

export class AuditLog {
  constructor(private readonly path: string) {}

  async write(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  }
}
