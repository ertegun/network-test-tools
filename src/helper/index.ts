// Yetkili yardımcı giriş noktası. Main process aynı doğrulamayı yetki istemeden önce
// yapar (erken red, gereksiz UAC/parola penceresi yok); yardımcı yükseltilmiş olarak
// çalıştığında doğrulamayı yeniden yapar (derinlemesine savunma).

import { readFile, writeFile } from 'node:fs/promises';
import type { Platform } from '../platform';
import type { PrivilegedResult } from '../shared/types';
import { InvalidParamsError, isWhitelisted, OPERATIONS, type OperationName } from './operations';

export interface HelperRequest {
  op: string;
  params?: unknown;
}

export type Validated = { ok: true; op: OperationName; params: unknown } | { ok: false; result: PrivilegedResult };

/** İşlem beyaz listede mi ve parametreleri geçerli mi? Hiçbir şey çalıştırmaz. */
export function validateRequest(req: unknown): Validated {
  const r = (typeof req === 'object' && req !== null ? req : {}) as Partial<HelperRequest>;
  if (!isWhitelisted(r.op)) {
    return { ok: false, result: { ok: false, code: 'notWhitelisted', message: `İzin verilmeyen işlem: ${String(r.op).slice(0, 100)}` } };
  }
  try {
    const params = (OPERATIONS[r.op].parse as (raw: unknown) => unknown)(r.params ?? {});
    return { ok: true, op: r.op, params };
  } catch (err) {
    if (err instanceof InvalidParamsError) return { ok: false, result: { ok: false, code: 'invalidParams', message: err.message } };
    throw err;
  }
}

export async function handleRequest(req: unknown, platform: Platform): Promise<PrivilegedResult> {
  const v = validateRequest(req);
  if (!v.ok) return v.result;
  try {
    const run = OPERATIONS[v.op].run as (p: unknown, platform: Platform) => Promise<unknown>;
    return { ok: true, output: await run(v.params, platform) };
  } catch (err) {
    return { ok: false, code: 'failed', message: (err as Error).message };
  }
}

/** Yükseltilmiş süreçte çağrılır: isteği dosyadan okur, sonucu dosyaya yazar. */
export async function runHelperFromFiles(requestPath: string, resultPath: string, platform: Platform): Promise<number> {
  let result: PrivilegedResult;
  try {
    const req = JSON.parse(await readFile(requestPath, 'utf8')) as unknown;
    result = await handleRequest(req, platform);
  } catch (err) {
    result = { ok: false, code: 'failed', message: (err as Error).message };
  }
  await writeFile(resultPath, JSON.stringify(result), 'utf8');
  return result.ok ? 0 : 1;
}
