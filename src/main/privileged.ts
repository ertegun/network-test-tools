// Yetkili işlemler: önce beyaz liste/parametre doğrulaması (yetki penceresi açılmadan),
// sonra işletim sisteminin yetki penceresiyle yardımcı süreç başlatılır.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRequest } from '../helper';
import { run, type Runner } from '../platform/exec';
import type { PrivilegedResult } from '../shared/types';
import type { AuditLog } from './audit';

export const HELPER_FLAG = '--netkit-helper';

export interface ElevateTarget {
  /** Çalıştırılacak dosya (Electron/uygulama ikilisi). */
  exe: string;
  /** Yardımcı bayrağından önce gelen argümanlar (geliştirmede uygulama dizini). */
  prefixArgs: string[];
}

export type Elevator = (args: string[]) => Promise<{ code: number; stderr: string }>;

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
        timeoutMs: 120_000,
        env: { ...process.env, NETKIT_EXE: target.exe, NETKIT_ARGS: argLine },
      });
      return { code: r.code, stderr: r.stderr };
    }
    if (process.platform === 'darwin') {
      const env: NodeJS.ProcessEnv = { ...process.env, NETKIT_EXE: target.exe };
      all.forEach((a, i) => (env[`NETKIT_ARG${i}`] = a));
      const parts = ['quoted form of (system attribute "NETKIT_EXE")', ...all.map((_, i) => `quoted form of (system attribute "NETKIT_ARG${i}")`)];
      const script = `do shell script ${parts.join(' & " " & ')} with administrator privileges`;
      const r = await runner('osascript', ['-e', script], { timeoutMs: 120_000, env });
      return { code: r.code, stderr: r.stderr };
    }
    // Linux: polkit. Kök olarak Electron'un sandbox'ı ve ekran sunucusu olmadan açılması için bayraklar.
    const r = await runner('pkexec', [target.exe, ...all, '--no-sandbox', '--ozone-platform=headless'], { timeoutMs: 120_000 });
    return { code: r.code, stderr: r.stderr };
  };
}

function isCancelled(code: number, stderr: string): boolean {
  // Windows: UAC iptali; macOS: -128 User canceled; Linux: pkexec 126 (iptal) / 127 (yetki yok).
  return /cancel|iptal|-128/i.test(stderr) || (process.platform === 'linux' && (code === 126 || code === 127));
}

/** Günlükte büyük parametreler (ör. hosts içeriği) kısaltılır. */
function summarize(params: unknown): unknown {
  const json = JSON.stringify(params ?? null);
  return json.length > 2000 ? `${json.slice(0, 2000)}…(${json.length} karakter)` : params;
}

export interface AuditMeta {
  previous?: unknown;
  next?: unknown;
}

export class PrivilegedRunner {
  constructor(
    private readonly elevate: Elevator,
    private readonly audit: AuditLog,
  ) {}

  async run(op: unknown, params: unknown, meta: AuditMeta = {}): Promise<PrivilegedResult> {
    const opName = typeof op === 'string' ? op.slice(0, 100) : String(op);
    const v = validateRequest({ op, params });
    if (!v.ok) {
      await this.audit.write({ op: opName, params: summarize(params), outcome: 'rejected', message: v.result.ok ? undefined : v.result.message });
      return v.result;
    }
    const dir = await mkdtemp(join(tmpdir(), 'netkit-'));
    const reqPath = join(dir, 'request.json');
    const resPath = join(dir, 'result.json');
    let result: PrivilegedResult;
    try {
      await writeFile(reqPath, JSON.stringify({ op: v.op, params }), 'utf8');
      const r = await this.elevate([HELPER_FLAG, reqPath, resPath]);
      try {
        result = JSON.parse(await readFile(resPath, 'utf8')) as PrivilegedResult;
      } catch {
        result = isCancelled(r.code, r.stderr)
          ? { ok: false, code: 'cancelled', message: 'Yetki isteği iptal edildi' }
          : { ok: false, code: 'failed', message: r.stderr.trim().slice(0, 300) || `çıkış kodu ${r.code}` };
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    await this.audit.write({
      op: v.op,
      params: summarize(params),
      previous: meta.previous,
      next: meta.next,
      outcome: result.ok ? 'ok' : result.code === 'cancelled' ? 'cancelled' : result.code === 'notWhitelisted' || result.code === 'invalidParams' ? 'rejected' : 'failed',
      message: result.ok ? undefined : result.message,
    });
    return result;
  }
}
