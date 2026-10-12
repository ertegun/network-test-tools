// Dış komut çalıştırma. Kabuk kullanılmaz (execFile): argümanlar ayrı ayrı geçer,
// kullanıcı girdisi komut satırında yorumlanamaz.

import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type Runner = (cmd: string, args: readonly string[], opts?: ExecOptions) => Promise<ExecResult>;

export const run: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { timeout: opts.timeoutMs ?? 15_000, windowsHide: true, env: opts.env ?? process.env, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')), code });
      },
    );
  });

/** Komut dizisini sırayla çalıştırır; ilk hatada durur ve Error fırlatır. */
export async function runAll(runner: Runner, commands: readonly (readonly string[])[], opts?: ExecOptions): Promise<void> {
  for (const [cmd, ...args] of commands) {
    const r = await runner(cmd, args, opts);
    if (r.code !== 0) throw new Error(`${cmd} ${args[0] ?? ''} başarısız (${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  }
}
