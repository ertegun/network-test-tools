// Yetkili işlemler: önce beyaz liste/parametre doğrulaması (yetki penceresi açılmadan),
// sonra işletim sisteminin yetki penceresiyle yardımcı süreç başlatılır. İstek ve sonuç
// yerel kanal üzerinden taşınır (bkz. helper/channel.ts); diske istek/sonuç dosyası yazılmaz.

import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { validateRequest } from '../helper';
import { createEndpoint, isMsg, newToken, onMessages, send, sha256, type Endpoint, type ToHelper, type ToMain } from '../helper/channel';
import { run, type Runner } from '../platform/exec';
import type { ChangeStatus, PendingChangeJournal, PrivilegedResult } from '../shared/types';
import type { AuditLog } from './audit';

export const HELPER_FLAG = '--netkit-helper';

export interface ElevateTarget {
  /** Çalıştırılacak dosya (Electron/uygulama ikilisi). */
  exe: string;
  /** Yardımcı bayrağından önce gelen argümanlar (geliştirmede uygulama dizini). */
  prefixArgs: string[];
}

export type Elevator = (args: string[]) => Promise<{ code: number; stderr: string }>;

/** Yetki penceresinin yanıtlanması için üst sınır; bağlanmış yardımcı bu süreyle kesilmez. */
const ELEVATE_TIMEOUT_MS = 120_000;
const HELLO_WAIT_MS = 10_000;

/** Platforma göre yetki penceresiyle süreç başlatan fonksiyonu üretir. Kullanıcı girdisi buraya gelmez. */
export function createElevator(target: ElevateTarget, runner: Runner = run): Elevator {
  return async (args) => {
    const all = [...target.prefixArgs, ...args];
    if (process.platform === 'win32') {
      // Yollar ortam değişkeniyle geçer; PowerShell betiği sabittir.
      const argLine = all.map((a) => `"${a.replace(/"/g, '')}"`).join(' ');
      const script =
        '$p = Start-Process -FilePath $env:NETKIT_EXE -ArgumentList $env:NETKIT_ARGS -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode';
      const r = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeoutMs: ELEVATE_TIMEOUT_MS,
        env: { ...process.env, NETKIT_EXE: target.exe, NETKIT_ARGS: argLine },
      });
      return { code: r.code, stderr: r.stderr };
    }
    if (process.platform === 'darwin') {
      const env: NodeJS.ProcessEnv = { ...process.env, NETKIT_EXE: target.exe };
      all.forEach((a, i) => (env[`NETKIT_ARG${i}`] = a));
      const parts = ['quoted form of (system attribute "NETKIT_EXE")', ...all.map((_, i) => `quoted form of (system attribute "NETKIT_ARG${i}")`)];
      const script = `do shell script ${parts.join(' & " " & ')} with administrator privileges`;
      const r = await runner('osascript', ['-e', script], { timeoutMs: ELEVATE_TIMEOUT_MS, env });
      return { code: r.code, stderr: r.stderr };
    }
    // Linux: polkit. Kök olarak Electron'un sandbox'ı ve ekran sunucusu olmadan açılması için bayraklar.
    const r = await runner('pkexec', [target.exe, ...all, '--no-sandbox', '--ozone-platform=headless'], { timeoutMs: ELEVATE_TIMEOUT_MS });
    return { code: r.code, stderr: r.stderr };
  };
}

function isCancelled(code: number, stderr: string): boolean {
  // Windows: UAC iptali; macOS: -128 User canceled; Linux: pkexec 126 (iptal) / 127 (yetki yok).
  return /cancel|iptal|-128/i.test(stderr) || (process.platform === 'linux' && (code === 126 || code === 127));
}

/** Günlükte büyük parametreler (ör. hosts kayıtları) kısaltılır. */
function summarize(params: unknown): unknown {
  const json = JSON.stringify(params ?? null);
  return json.length > 2000 ? `${json.slice(0, 2000)}…(${json.length} karakter)` : params;
}

function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export interface AuditMeta {
  previous?: unknown;
  next?: unknown;
}

export interface SessionHandlers {
  /** Onaylı değişiklikte yardımcının bildirdiği durum. */
  onStatus?(s: ChangeStatus): void;
  /** Yardımcının günlüğü; kaydedilince yardımcıya onay gider. Reddedilirse değişiklik uygulanmaz. */
  onJournal?(j: PendingChangeJournal | null): Promise<void>;
}

export interface PrivilegedSession {
  result: Promise<PrivilegedResult>;
  /** Çalışan yardımcıya onay/geri al komutu iletir. */
  command(c: 'confirm' | 'revert'): void;
}

export class PrivilegedRunner {
  constructor(
    private readonly elevate: Elevator,
    private readonly audit: AuditLog,
    private readonly newEndpoint: () => Promise<Endpoint> = () => createEndpoint(),
  ) {}

  async run(op: unknown, params: unknown, meta: AuditMeta = {}): Promise<PrivilegedResult> {
    return this.start(op, params, meta).result;
  }

  /** Yardımcıyı başlatır; yardımcı bağlı kaldıkça komut gönderilebilir. */
  start(op: unknown, params: unknown, meta: AuditMeta = {}, handlers: SessionHandlers = {}): PrivilegedSession {
    let socket: Socket | undefined;
    const queued: ToHelper[] = [];
    const command = (c: 'confirm' | 'revert') => {
      if (socket) send(socket, { t: c });
      else queued.push({ t: c });
    };
    const result = this.execute(op, params, meta, handlers, (s) => {
      socket = s;
      queued.splice(0).forEach((m) => send(s, m));
    });
    return { result, command };
  }

  private async execute(op: unknown, params: unknown, meta: AuditMeta, handlers: SessionHandlers, onConnected: (s: Socket) => void): Promise<PrivilegedResult> {
    const opName = typeof op === 'string' ? op.slice(0, 100) : String(op);
    const v = validateRequest({ op, params });
    if (!v.ok) {
      await this.audit.write({ op: opName, params: summarize(params), outcome: 'rejected', message: v.result.ok ? undefined : v.result.message });
      return v.result;
    }
    const body = JSON.stringify({ op: v.op, params });
    const token = newToken();
    const endpoint = await this.newEndpoint();
    const server = createServer();
    let helper: Socket | undefined;
    let received: PrivilegedResult | undefined;
    let journalPrevious: unknown;
    let closed!: () => void;
    const helperClosed = new Promise<void>((r) => (closed = r));

    server.on('connection', (s) => {
      // Belirteci gönderen ilk bağlantı yardımcıdır; diğerleri kapatılır.
      if (helper) return s.destroy();
      let authed = false;
      const helloTimer = setTimeout(() => !authed && s.destroy(), HELLO_WAIT_MS);
      s.on('error', () => undefined);
      onMessages(s, (m) => {
        if (!authed) {
          clearTimeout(helloTimer);
          if (helper || !isMsg<ToMain>(m, 'hello') || !tokenMatches((m as { token?: unknown }).token, token)) return s.destroy();
          authed = true;
          helper = s;
          server.close();
          s.on('close', closed);
          send(s, { t: 'request', body });
          onConnected(s);
          return;
        }
        const msg = m as ToMain;
        if (msg.t === 'status') handlers.onStatus?.(msg.status);
        else if (msg.t === 'journal') {
          if (msg.journal) journalPrevious = msg.journal.previous;
          // Kayıt başarısızsa onay gönderilmez; yardımcı günlüksüz değişiklik yapmaz.
          void Promise.resolve(handlers.onJournal?.(msg.journal)).then(
            () => send(s, { t: 'journalSaved' }),
            () => undefined,
          );
        } else if (msg.t === 'result') received = msg.result;
      });
    });

    let result: PrivilegedResult;
    try {
      await listen(server, endpoint.path);
      const r = await this.elevate([HELPER_FLAG, endpoint.path, token, sha256(body)]);
      // Yardımcı bağlıysa (ör. yetki aracı zaman aşımıyla kesildi) bağlantı kapanana kadar beklenir.
      if (helper && !received) await helperClosed;
      result =
        received ??
        (isCancelled(r.code, r.stderr)
          ? { ok: false, code: 'cancelled', message: 'Yetki isteği iptal edildi' }
          : { ok: false, code: 'failed', message: r.stderr.trim().slice(0, 300) || `çıkış kodu ${r.code}` });
    } catch (err) {
      result = { ok: false, code: 'failed', message: (err as Error).message };
    } finally {
      server.close();
      (helper as Socket | undefined)?.destroy();
      await endpoint.cleanup().catch(() => undefined);
    }
    const phase = result.ok ? (result.output as { phase?: unknown } | null)?.phase : undefined;
    await this.audit.write({
      op: v.op,
      params: summarize(params),
      previous: meta.previous ?? journalPrevious,
      next: meta.next,
      outcome: result.ok ? 'ok' : result.code === 'cancelled' ? 'cancelled' : result.code === 'notWhitelisted' || result.code === 'invalidParams' ? 'rejected' : 'failed',
      message: result.ok ? (typeof phase === 'string' ? phase : undefined) : result.message,
    });
    return result;
  }
}
