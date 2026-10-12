// Yetkili yardımcı giriş noktası. Main process aynı doğrulamayı yetki istemeden önce
// yapar (erken red, gereksiz UAC/parola penceresi yok); yardımcı yükseltilmiş olarak
// çalıştığında doğrulamayı yeniden yapar (derinlemesine savunma).

import { connect } from 'node:net';
import type { Platform } from '../platform';
import type { PrivilegedResult } from '../shared/types';
import type { ChangeCommand, SessionContext } from './change';
import { onMessages, send, sha256, type ToHelper } from './channel';
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

/** Main'e bağlı olmayan çağrılar için (testler): günlük kabul edilir, komut gelmez. */
const detachedContext: SessionContext = { status: () => undefined, saveJournal: async () => undefined, onCommand: () => undefined };

export async function handleRequest(req: unknown, platform: Platform, ctx: SessionContext = detachedContext): Promise<PrivilegedResult> {
  const v = validateRequest(req);
  if (!v.ok) return v.result;
  try {
    const run = OPERATIONS[v.op].run as (p: unknown, platform: Platform, ctx: SessionContext) => Promise<unknown>;
    return { ok: true, output: await run(v.params, platform, ctx) };
  } catch (err) {
    return { ok: false, code: 'failed', message: (err as Error).message };
  }
}

export interface HelperArgs {
  /** Main'in dinlediği named pipe / Unix soketi. */
  endpoint: string;
  token: string;
  /** İsteğin SHA-256 özeti; kanaldan gelen istek bununla eşleşmezse çalıştırılmaz. */
  requestHash: string;
}

const REQUEST_WAIT_MS = 30_000;
const JOURNAL_ACK_MS = 5000;

/**
 * Yükseltilmiş süreçte çağrılır: main'in kanalına bağlanır, isteği alır, özeti doğrular,
 * çalıştırır ve sonucu aynı kanaldan döndürür. Diske dosya yazmaz.
 */
export function runHelper(args: HelperArgs, platform: Platform, opts: { confirmTimeoutMs?: number } = {}): Promise<number> {
  return new Promise((resolve) => {
    const socket = connect(args.endpoint);
    let started = false;
    let connected = true;
    let finished = false;
    const commandListeners: ((c: ChangeCommand) => void)[] = [];
    let journalAck: (() => void) | undefined;

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(requestTimer);
      socket.end(() => resolve(code));
      // Main yanıt vermezse en geç kısa süre sonra çıkılır.
      setTimeout(() => {
        socket.destroy();
        resolve(code);
      }, 2000);
    };

    const requestTimer = setTimeout(() => {
      if (!started) {
        socket.destroy();
        resolve(1);
      }
    }, REQUEST_WAIT_MS);

    const ctx: SessionContext = {
      ...opts,
      status: (status) => send(socket, { t: 'status', status }),
      saveJournal: (journal) =>
        new Promise<void>((ok, fail) => {
          // Main yoksa günlük silme bekletilmez; yazma ise reddedilir (günlüksüz değişiklik yapılmaz).
          if (!connected) return journal === null ? ok() : fail(new Error('main bağlantısı yok'));
          const t = setTimeout(() => (journal === null ? ok() : fail(new Error('günlük kaydı doğrulanmadı'))), JOURNAL_ACK_MS);
          journalAck = () => {
            clearTimeout(t);
            ok();
          };
          send(socket, { t: 'journal', journal });
        }),
      onCommand: (cb) => commandListeners.push(cb),
    };

    const execute = async (body: string) => {
      let result: PrivilegedResult;
      if (sha256(body) !== args.requestHash) {
        result = { ok: false, code: 'failed', message: 'İstek bütünlük denetimini geçmedi' };
      } else {
        try {
          result = await handleRequest(JSON.parse(body) as unknown, platform, ctx);
        } catch (err) {
          result = { ok: false, code: 'failed', message: (err as Error).message };
        }
      }
      send(socket, { t: 'result', result });
      finish(result.ok ? 0 : 1);
    };

    socket.on('connect', () => send(socket, { t: 'hello', token: args.token }));
    onMessages(socket, (m) => {
      const msg = m as ToHelper;
      if (msg.t === 'request' && !started && typeof msg.body === 'string') {
        started = true;
        void execute(msg.body);
      } else if (msg.t === 'journalSaved') {
        journalAck?.();
        journalAck = undefined;
      } else if (msg.t === 'confirm' || msg.t === 'revert') {
        commandListeners.forEach((cb) => cb(msg.t));
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      connected = false;
      if (!started) {
        clearTimeout(requestTimer);
        resolve(1);
        return;
      }
      commandListeners.forEach((cb) => cb('disconnect'));
    });
  });
}
