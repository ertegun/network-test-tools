// Tor'u Docker container olarak tek tıkla başlatma. Docker yalnızca burada, sabit
// argümanlarla çağrılır; renderer'dan komut metni alınmaz.

import { execFile } from 'node:child_process';
import { TOR_CONTAINER, TOR_DOCKER_RUN_ARGS, type TorSetupStatus } from '../shared/types';

export const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/';
const DOCKER_INFO_MS = 5000;

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
  /** `docker` çalıştırılamadı (ENOENT): kurulu değil ya da PATH'te yok. */
  missing: boolean;
}

/** timeoutMs 0: süre sınırı yok (ilk imaj indirmesi uzun sürebilir). */
export type DockerExec = (args: readonly string[], timeoutMs: number) => Promise<DockerResult>;

export const dockerExec: DockerExec = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile('docker', [...args], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      resolve({
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr || (e && !stderr ? e.message : '')),
        missing: e?.code === 'ENOENT',
      });
    });
  });

const firstLine = (r: DockerResult) => (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/)[0] || `docker exit ${r.code}`;

/** Docker'ı kontrol eder; sabit adlı container varsa başlatır, yoksa oluşturur. */
export async function startTor(exec: DockerExec = dockerExec): Promise<TorSetupStatus> {
  const info = await exec(['info'], DOCKER_INFO_MS);
  if (info.missing) return { state: 'notInstalled' };
  if (info.code !== 0) return { state: 'daemonOff' };
  const exists = (await exec(['container', 'inspect', TOR_CONTAINER], DOCKER_INFO_MS)).code === 0;
  const r = await exec(exists ? ['start', TOR_CONTAINER] : TOR_DOCKER_RUN_ARGS, 0);
  return r.code === 0 ? { state: 'running' } : { state: 'error', message: firstLine(r) };
}

/** Aynı anda gelen ikinci istek ilkinin sonucunu bekler (çift tıklamada tek container). */
export function torStarter(exec?: DockerExec): () => Promise<TorSetupStatus> {
  let inFlight: Promise<TorSetupStatus> | undefined;
  return () => (inFlight ??= startTor(exec).finally(() => (inFlight = undefined)));
}
