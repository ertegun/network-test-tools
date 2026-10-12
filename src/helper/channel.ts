// Main ile yetkili yardımcı arasındaki yerel kanal: Windows'ta named pipe, macOS/Linux'ta
// kullanıcıya özel (0700) dizindeki Unix soketi. Diske istek/sonuç dosyası yazılmaz;
// yükseltilmiş süreç kullanıcı dizinlerine hiç yazmaz. Mesajlar satır başına bir JSON'dur.
//
// Bütünlük: main isteğin SHA-256 özetini yardımcının komut satırına koyar. Yardımcı kanaldan
// gelen isteği bu özetle karşılaştırır; arada değiştirilmiş istek çalıştırılmaz.
// Kimlik: yardımcı ilk mesajda komut satırındaki rastgele belirteci gönderir; main
// belirteci tutmayan bağlantıyı kapatır.

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeStatus, PendingChangeJournal, PrivilegedResult } from '../shared/types';

/** Main → yardımcı */
export type ToHelper = { t: 'request'; body: string } | { t: 'confirm' } | { t: 'revert' } | { t: 'journalSaved' };

/** Yardımcı → main */
export type ToMain =
  | { t: 'hello'; token: string }
  | { t: 'status'; status: ChangeStatus }
  | { t: 'journal'; journal: PendingChangeJournal | null }
  | { t: 'result'; result: PrivilegedResult };

/** Tek satırın üst sınırı (hosts kayıtları dahil istekler bunun çok altında kalır). */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export const newToken = () => randomBytes(32).toString('hex');

export interface Endpoint {
  path: string;
  cleanup(): Promise<void>;
}

/** Tahmin edilemez adlı bir kanal adresi üretir. */
export async function createEndpoint(platform: NodeJS.Platform = process.platform): Promise<Endpoint> {
  if (platform === 'win32') {
    return { path: `\\\\.\\pipe\\netkit-${randomBytes(16).toString('hex')}`, cleanup: async () => undefined };
  }
  // mkdtemp dizini 0700 oluşturur; soket yalnızca bu kullanıcı (ve root) tarafından açılabilir.
  const dir = await mkdtemp(join(tmpdir(), 'netkit-'));
  return { path: join(dir, 'h.sock'), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function send(socket: Socket, msg: ToHelper | ToMain): void {
  if (!socket.destroyed && socket.writable) socket.write(JSON.stringify(msg) + '\n');
}

/** Gelen akışı satırlara böler ve her satırı JSON olarak verir. Bozuk veya aşırı büyük veride bağlantı kapatılır. */
export function onMessages(socket: Socket, cb: (msg: unknown) => void): void {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buf += chunk;
    if (buf.length > MAX_MESSAGE_BYTES) {
      socket.destroy();
      return;
    }
    let i: number;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        cb(JSON.parse(line) as unknown);
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}

export function isMsg<T extends { t: string }>(m: unknown, t: T['t']): m is T {
  return typeof m === 'object' && m !== null && (m as { t?: unknown }).t === t;
}
